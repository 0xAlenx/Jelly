import Router from '@koa/router'
import { Readable } from 'stream'
import { randomBytes, randomUUID } from 'crypto'
import {
  activateDevice,
  cloudFetch,
  cloudFetchForLocalProxySecret,
  getOrCreateLocalProxySecret,
  hostedCloudFetch,
  loginWithHostedLicenseKey,
  loginWithLicenseKey,
  logoutCloudSession,
  logoutHostedCloudSession,
  requireActivatedDeviceSession,
} from '../../services/jellyai/device-session'
import { createUser, findUserByUsername, updateUser } from '../../db/hermes/users-store'
import { issueUserJwt } from '../../middleware/user-auth'
import { listProfileNamesFromDisk } from '../../services/hermes/hermes-profile'
import { AgentBridgeClient, type AgentBridgeMessage } from '../../services/hermes/agent-bridge'
import { ensureHostedProfile } from '../../services/jellyai/hosted-profile'
import { hostedAccountIdFromUsername, hostedUsername, isJellyWebHostedMode } from '../../services/jellyai/web-hosted-mode'

function error(ctx: any, err: unknown) {
  const code = err instanceof Error ? err.message : 'JELLY_GATEWAY_ERROR'
  ctx.status = [
    'DEVICE_ACTIVATION_REQUIRED',
    'HOSTED_SESSION_REQUIRED',
    'INVALID_LICENSE',
    'INVALID_REFRESH_TOKEN',
    'UNAUTHORIZED_LOCAL_PROXY',
  ].includes(code) ? 401 : 502
  ctx.body = { code, error: code }
}

function localProxySecret(ctx: any): string {
  const header = String(ctx.headers.authorization ?? '')
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

function requireDeviceLocalProxySecret(ctx: any): boolean {
  return localProxySecret(ctx) === getOrCreateLocalProxySecret()
}

function hostedAccountId(ctx: any): string | null {
  if (!isJellyWebHostedMode()) return null
  return hostedAccountIdFromUsername(String(ctx.state?.user?.username ?? ''))
}

function cloudFetchForUser(ctx: any, path: string, init: RequestInit = {}) {
  const accountId = hostedAccountId(ctx)
  return accountId ? hostedCloudFetch(accountId, path, init) : cloudFetch(path, init)
}

function messageText(content: unknown): AgentBridgeMessage {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content as Array<Record<string, unknown>>
  return String(content ?? '')
}

function lastUserMessageIndex(messages: Array<{ role?: unknown }>): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index
  }
  return -1
}

function sseChunk(id: string, content: string, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'jelly-managed',
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
  })}\n\n`
}

function bridgeFallbackMessage(chunk: { error?: string | null; result?: unknown }): string {
  const result = chunk.result as Record<string, unknown> | undefined
  const resultText = result && [
    result.final_response,
    result.response,
    result.output,
    result.error,
  ].find(value => typeof value === 'string' && value.trim())
  const raw = `${typeof resultText === 'string' ? resultText : ''}\n${chunk.error || ''}`
  if (raw.includes('INSUFFICIENT_CREDITS')) return '积分不足，请联系管理员充值。'
  if (raw.includes('LICENSE_EXPIRED')) return '授权已过期，请联系管理员续期。'
  if (raw.includes('ACCOUNT_DISABLED')) return '当前账号已停用，请联系管理员。'
  if (typeof resultText === 'string') return resultText
  if (chunk.error) return `JellyAI Agent 调用失败：${chunk.error}`
  return 'JellyAI 当前无法生成回复，请检查授权或积分后重试。'
}

async function runChannelAgent(ctx: any) {
  if (!requireDeviceLocalProxySecret(ctx)) {
    ctx.status = 401
    ctx.body = { code: 'UNAUTHORIZED_LOCAL_PROXY', error: 'Unauthorized local proxy request.' }
    return
  }

  try {
    await requireActivatedDeviceSession()
    const body = (ctx.request.body ?? {}) as { messages?: Array<{ role?: unknown; content?: unknown }> }
    const messages = Array.isArray(body.messages) ? body.messages : []
    const lastUserIndex = lastUserMessageIndex(messages)
    if (lastUserIndex < 0) {
      ctx.status = 400
      ctx.body = { code: 'USER_MESSAGE_REQUIRED', error: 'A user message is required.' }
      return
    }

    const requestId = randomUUID()
    const bridge = new AgentBridgeClient()
    const sessionId = String(ctx.headers['x-hermes-session-id'] ?? `jelly-channel-${requestId}`).trim()
    const instructions = messages
      .filter(message => message?.role === 'system')
      .map(message => String(message.content ?? '').trim())
      .filter(Boolean)
      .join('\n\n')
    const conversationHistory = messages
      .slice(0, lastUserIndex)
      .filter(message => message?.role !== 'system')
    const started = await bridge.chat(
      sessionId,
      messageText(messages[lastUserIndex]?.content),
      conversationHistory,
      instructions || undefined,
      undefined,
      { source: 'jelly-channel' },
    )
    const stream = new Readable({ read() {} })

    ctx.status = 200
    ctx.set('Content-Type', 'text/event-stream; charset=utf-8')
    ctx.set('Cache-Control', 'no-cache, no-transform')
    ctx.set('Connection', 'keep-alive')
    ctx.set('X-Jelly-Request-Id', requestId)
    ctx.body = stream

    void (async () => {
      let delivered = false
      try {
        for await (const chunk of bridge.streamOutput(started.run_id, { timeoutMs: 0 })) {
          if (chunk.delta) {
            delivered = true
            stream.push(sseChunk(requestId, chunk.delta))
          }
          if (chunk.done && !delivered) {
            delivered = true
            stream.push(sseChunk(requestId, bridgeFallbackMessage(chunk)))
          }
        }
        stream.push(sseChunk(requestId, '', 'stop'))
        stream.push('data: [DONE]\n\n')
        stream.push(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'UNKNOWN_AGENT_ERROR'
        stream.push(sseChunk(requestId, `\n\nJellyAI Agent 调用失败：${message}`))
        stream.push(sseChunk(requestId, '', 'stop'))
        stream.push('data: [DONE]\n\n')
        stream.push(null)
      }
    })()
  } catch (err) {
    error(ctx, err)
  }
}

async function proxyModel(ctx: any, endpoint: '/v1/chat/completions' | '/v1/responses') {
  const secret = localProxySecret(ctx)
  if (!secret) {
    ctx.status = 401
    ctx.body = { code: 'UNAUTHORIZED_LOCAL_PROXY', error: 'Unauthorized local proxy request.' }
    return
  }
  try {
    const response = await cloudFetchForLocalProxySecret(secret, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ctx.headers['x-request-id'] ? { 'X-Request-Id': String(ctx.headers['x-request-id']) } : {}),
        ...(ctx.headers['x-jelly-skill-id'] ? { 'X-Jelly-Skill-Id': String(ctx.headers['x-jelly-skill-id']) } : {}),
        ...(ctx.headers['x-jelly-agent-id'] ? { 'X-Jelly-Agent-Id': String(ctx.headers['x-jelly-agent-id']) } : {}),
      },
      body: JSON.stringify(ctx.request.body ?? {}),
    })
    ctx.status = response.status
    ctx.set('Content-Type', response.headers.get('content-type') || 'application/json')
    const requestId = response.headers.get('x-jelly-request-id')
    if (requestId) ctx.set('X-Jelly-Request-Id', requestId)
    const selectedModel = response.headers.get('x-jelly-model')
    if (selectedModel) ctx.set('X-Jelly-Model', selectedModel)
    const creditsCost = response.headers.get('x-jelly-credits-cost')
    if (creditsCost) ctx.set('X-Jelly-Credits-Cost', creditsCost)
    ctx.body = response.body ? Readable.fromWeb(response.body as any) : null
  } catch (err) {
    error(ctx, err)
  }
}

async function proxyCloudFacade(ctx: any, endpoint: '/api/jelly/chat' | '/api/jelly/agent/run' | '/api/jelly/skills/run') {
  try {
    const response = await cloudFetchForUser(ctx, endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx.request.body ?? {}),
    })
    ctx.status = response.status
    ctx.set('Content-Type', response.headers.get('content-type') || 'application/json')
    const requestId = response.headers.get('x-jelly-request-id')
    if (requestId) ctx.set('X-Jelly-Request-Id', requestId)
    const selectedModel = response.headers.get('x-jelly-model')
    if (selectedModel) ctx.set('X-Jelly-Model', selectedModel)
    const creditsCost = response.headers.get('x-jelly-credits-cost')
    if (creditsCost) ctx.set('X-Jelly-Credits-Cost', creditsCost)
    ctx.body = response.body ? Readable.fromWeb(response.body as any) : null
  } catch (err) {
    error(ctx, err)
  }
}

export const jellyCloudPublicRoutes = new Router()
jellyCloudPublicRoutes.post('/api/jelly/model/v1/chat/completions', ctx => proxyModel(ctx, '/v1/chat/completions'))
jellyCloudPublicRoutes.post('/api/jelly/model/v1/responses', ctx => proxyModel(ctx, '/v1/responses'))
jellyCloudPublicRoutes.post('/api/jelly/channel-agent/v1/chat/completions', runChannelAgent)
jellyCloudPublicRoutes.post('/api/jelly/cloud/license-login', async (ctx) => {
  try {
    const licenseKey = String((ctx.request.body as any)?.licenseKey ?? '').trim()
    if (!licenseKey) {
      ctx.status = 400
      ctx.body = { code: 'LICENSE_KEY_REQUIRED', error: 'licenseKey is required.' }
      return
    }
    const hosted = isJellyWebHostedMode()
    const hostedSession = hosted ? await loginWithHostedLicenseKey(licenseKey) : null
    if (!hostedSession) await loginWithLicenseKey(licenseKey)
    const username = hostedSession ? hostedUsername(hostedSession.accountId) : 'jellyai-user'
    const profiles = hostedSession
      ? [await ensureHostedProfile(hostedSession.accountId, hostedSession.localProxySecret)]
      : listProfileNamesFromDisk()
    const defaultProfile = hostedSession
      ? profiles[0]
      : profiles.includes('default') ? 'default' : profiles[0]
    let user = findUserByUsername(username)
    if (!user) {
      user = createUser({
        username,
        password: randomBytes(32).toString('hex'),
        role: 'admin',
        profiles,
        defaultProfile,
      })
    } else {
      user = updateUser({
        userId: user.id,
        status: 'active',
        profiles,
        defaultProfile,
      })
    }
    if (!user) throw new Error('LOCAL_JELLY_USER_CREATE_FAILED')
    ctx.body = { token: await issueUserJwt(user) }
  } catch (err) {
    error(ctx, err)
  }
})

export const jellyCloudProtectedRoutes = new Router()
jellyCloudProtectedRoutes.post('/api/jelly/cloud/device-activate', async (ctx) => {
  try {
    const body = ctx.request.body as any
    const licenseKey = String(body?.licenseKey ?? '').trim()
    const deviceId = String(body?.deviceId ?? '').trim()
    if (!licenseKey || !deviceId) {
      ctx.status = 400
      ctx.body = { code: 'LICENSE_KEY_AND_DEVICE_ID_REQUIRED', error: 'licenseKey and deviceId are required.' }
      return
    }
    await activateDevice({ licenseKey, deviceId, deviceName: String(body?.deviceName ?? '').trim() || undefined })
    ctx.body = { success: true }
  } catch (err) {
    error(ctx, err)
  }
})

jellyCloudProtectedRoutes.get('/api/jelly/cloud/me', async (ctx) => {
  try {
    const response = await cloudFetchForUser(ctx, '/api/jelly/me')
    ctx.status = response.status
    ctx.body = await response.json()
  } catch (err) {
    error(ctx, err)
  }
})

jellyCloudProtectedRoutes.post('/api/jelly/cloud/logout', async (ctx) => {
  const accountId = hostedAccountId(ctx)
  if (accountId) await logoutHostedCloudSession(accountId)
  else await logoutCloudSession()
  ctx.body = { success: true }
})

jellyCloudProtectedRoutes.post('/api/jelly/chat', ctx => proxyCloudFacade(ctx, '/api/jelly/chat'))
jellyCloudProtectedRoutes.post('/api/jelly/agent/run', ctx => proxyCloudFacade(ctx, '/api/jelly/agent/run'))
jellyCloudProtectedRoutes.post('/api/jelly/skills/run', ctx => proxyCloudFacade(ctx, '/api/jelly/skills/run'))
