import Router from '@koa/router'
import { Readable, Transform } from 'node:stream'
import { claims, requireAccess } from '../auth.js'
import { config } from '../config.js'
import { query } from '../db.js'
import { decryptSecret } from '../security.js'
import {
  createRequestMetadata,
  releaseCredits,
  reserveCredits,
  settleCredits,
  type PricingRow,
  type RequestMetadata,
  type Usage,
} from '../billing.js'

type ProxyPath = '/chat/completions' | '/responses'
type ProxyKind = 'chat' | 'agent' | 'skill'

class UpstreamRouteError extends Error {}

function error(ctx: any, err: unknown) {
  const code = err instanceof Error ? err.message : 'MODEL_GATEWAY_ERROR'
  ctx.status = code === 'INSUFFICIENT_CREDITS'
    ? 402
    : code.startsWith('ALL_MODELS_FAILED') || code === 'MODEL_GATEWAY_NOT_CONFIGURED'
      ? 503
      : 400
  ctx.body = { code, error: code }
}

function usageFromObject(payload: any): Usage | null {
  const usage = payload?.usage || payload?.response?.usage
  if (!usage) return null
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0)
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0)
  return { promptTokens, completionTokens }
}

interface ProviderRoute {
  baseUrl: string
  apiKey: string
}

async function providerRoute(pricing: PricingRow): Promise<ProviderRoute> {
  const rows = await query<{ base_url: string; api_key_ciphertext: string }>(
    `SELECT base_url, api_key_ciphertext
     FROM model_providers
     WHERE enabled = TRUE AND ($1::uuid IS NULL OR id = $1)
     ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, is_default DESC, created_at ASC
     LIMIT 1`,
    [pricing.provider_id],
  )
  const provider = rows[0]
  if (provider) {
    try {
      return {
        baseUrl: provider.base_url.replace(/\/+$/, ''),
        apiKey: decryptSecret(provider.api_key_ciphertext),
      }
    } catch {
      throw new UpstreamRouteError('MODEL_PROVIDER_KEY_DECRYPT_FAILED')
    }
  }
  if (pricing.provider_id) throw new UpstreamRouteError('MODEL_PROVIDER_NOT_AVAILABLE')
  if (!config.modelBaseUrl || !config.modelApiKey) throw new Error('MODEL_GATEWAY_NOT_CONFIGURED')
  return { baseUrl: config.modelBaseUrl, apiKey: config.modelApiKey }
}

function upstreamUrl(provider: ProviderRoute, path: ProxyPath): string {
  return `${provider.baseUrl}${path}`
}

async function upstreamError(response: Response): Promise<UpstreamRouteError> {
  const text = await response.text()
  let detail = text
  try {
    const payload = JSON.parse(text)
    detail = String(
      payload?.error?.message
      ?? payload?.error
      ?? payload?.message
      ?? payload?.base_resp?.status_msg
      ?? text,
    )
  } catch {
    // Preserve text responses from OpenAI-compatible upstreams.
  }
  const safeDetail = detail.replace(/\s+/g, ' ').trim().slice(0, 500)
  return new UpstreamRouteError(`UPSTREAM_${response.status}${safeDetail ? `: ${safeDetail}` : ''}`)
}

async function fetchUpstream(provider: ProviderRoute, path: ProxyPath, metadata: RequestMetadata, payload: any): Promise<Response> {
  try {
    return await fetch(upstreamUrl(provider, path), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
        'X-Request-Id': metadata.requestId,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    throw new UpstreamRouteError(`UPSTREAM_NETWORK_ERROR: ${err instanceof Error ? err.message : 'UNKNOWN_ERROR'}`)
  }
}

async function forwardJson(ctx: any, path: ProxyPath, accountId: string, metadata: RequestMetadata, pricing: PricingRow, provider: ProviderRoute, payload: any) {
  const response = await fetchUpstream(provider, path, metadata, { ...payload, model: pricing.upstream_model })
  if (!response.ok) throw await upstreamError(response)
  let result: any
  try {
    result = await response.json()
  } catch {
    throw new UpstreamRouteError('UPSTREAM_INVALID_JSON_RESPONSE')
  }
  const usage = usageFromObject(result) || { promptTokens: 0, completionTokens: 0 }
  const settlement = await settleCredits(accountId, metadata, pricing, usage)
  ctx.set('X-Jelly-Request-Id', metadata.requestId)
  ctx.set('X-Jelly-Credits-Cost', String(settlement.cost))
  ctx.set('X-Jelly-Model', pricing.upstream_model)
  ctx.body = result
}

async function forwardStream(ctx: any, path: ProxyPath, accountId: string, metadata: RequestMetadata, pricing: PricingRow, provider: ProviderRoute, payload: any) {
  const response = await fetchUpstream(provider, path, metadata, {
    ...payload,
    model: pricing.upstream_model,
    stream: true,
    ...(path === '/chat/completions' ? { stream_options: { include_usage: true } } : {}),
  })
  if (!response.ok) throw await upstreamError(response)
  if (!response.body) throw new UpstreamRouteError('UPSTREAM_STREAM_BODY_MISSING')

  let latestUsage: Usage = { promptTokens: 0, completionTokens: 0 }
  let buffer = ''
  let finalized = false
  async function releaseOnce(reason: string) {
    if (finalized) return
    finalized = true
    try {
      await releaseCredits(accountId, metadata, pricing, reason)
    } catch {
      // The reservation may already be settled or released.
    }
  }
  const inspect = new Transform({
    transform(chunk, _encoding, callback) {
      const text = chunk.toString()
      buffer += text
      for (const line of buffer.split('\n')) {
        const raw = line.startsWith('data:') ? line.slice(5).trim() : ''
        if (!raw || raw === '[DONE]') continue
        try {
          latestUsage = usageFromObject(JSON.parse(raw)) || latestUsage
        } catch {
          // Preserve upstream bytes even when an event is not JSON.
        }
      }
      buffer = buffer.slice(buffer.lastIndexOf('\n') + 1)
      callback(null, chunk)
    },
    flush(callback) {
      void settleCredits(accountId, metadata, pricing, latestUsage)
        .then(() => {
          finalized = true
          callback()
        })
        .catch(async (error) => {
          await releaseOnce(error instanceof Error ? error.message : 'SETTLEMENT_FAILED')
          callback(error as Error)
        })
    },
  })
  const source = Readable.fromWeb(response.body as any)
  source.once('error', error => void releaseOnce(error instanceof Error ? error.message : 'UPSTREAM_STREAM_FAILED'))
  inspect.once('close', () => void releaseOnce('STREAM_CLOSED_BEFORE_SETTLEMENT'))

  ctx.status = response.status
  ctx.set('Content-Type', response.headers.get('content-type') || 'text/event-stream')
  ctx.set('Cache-Control', 'no-cache')
  ctx.set('X-Jelly-Request-Id', metadata.requestId)
  ctx.set('X-Jelly-Model', pricing.upstream_model)
  ctx.body = source.pipe(inspect)
}

async function proxy(ctx: any, path: ProxyPath, kind: ProxyKind = 'chat') {
  const accountId = claims(ctx).sub
  let pricing: PricingRow | null = null
  let metadata: RequestMetadata | null = null
  try {
    const rawPayload = ctx.request.body ?? {}
    metadata = createRequestMetadata({
      ...ctx.headers,
      'x-jelly-skill-id': ctx.headers['x-jelly-skill-id'] || rawPayload.skillId,
      'x-jelly-agent-id': ctx.headers['x-jelly-agent-id'] || rawPayload.agentId,
    })
    if (kind === 'skill' && !metadata.skillId) throw new Error('SKILL_ID_REQUIRED')
    const { skillId: _skillId, agentId: _agentId, ...payload } = rawPayload
    const reserved = await reserveCredits(accountId, metadata, payload)
    pricing = reserved.pricing
    const failures: string[] = []
    for (const candidate of reserved.pricingCandidates) {
      pricing = candidate
      try {
        const provider = await providerRoute(pricing)
        if (payload.stream) await forwardStream(ctx, path, accountId, metadata, pricing, provider, payload)
        else await forwardJson(ctx, path, accountId, metadata, pricing, provider, payload)
        return
      } catch (err) {
        if (!(err instanceof UpstreamRouteError)) throw err
        failures.push(`${pricing.model}: ${err.message}`)
      }
    }
    throw new Error(`ALL_MODELS_FAILED: ${failures.join(' | ') || 'NO_ENABLED_MODEL'}`)
  } catch (err) {
    if (pricing && metadata) {
      try {
        await releaseCredits(accountId, metadata, pricing, err instanceof Error ? err.message : 'MODEL_GATEWAY_ERROR')
      } catch {
        // The reservation may already be settled or released.
      }
    }
    error(ctx, err)
  }
}

export const modelProxyRoutes = new Router()
modelProxyRoutes.post('/v1/chat/completions', requireAccess('account'), ctx => proxy(ctx, '/chat/completions'))
modelProxyRoutes.post('/v1/responses', requireAccess('account'), ctx => proxy(ctx, '/responses'))
modelProxyRoutes.post('/api/jelly/chat', requireAccess('account'), ctx => proxy(ctx, '/chat/completions'))
modelProxyRoutes.post('/api/jelly/agent/run', requireAccess('account'), ctx => proxy(ctx, '/chat/completions', 'agent'))
modelProxyRoutes.post('/api/jelly/skills/run', requireAccess('account'), ctx => proxy(ctx, '/chat/completions', 'skill'))
