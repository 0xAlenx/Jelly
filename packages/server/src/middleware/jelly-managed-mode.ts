import type { Context, Next } from 'koa'
import { isJellyManagedMode } from '../services/jellyai/managed-mode'

const BLOCKED_PREFIXES = [
  '/api/hermes/config/providers',
  '/api/hermes/config/credentials',
  '/api/hermes/config/models',
  '/api/hermes/available-models',
  '/api/hermes/model-context',
  '/api/hermes/auth/codex',
  '/api/hermes/auth/nous',
  '/api/hermes/auth/copilot',
  '/api/hermes/auth/xai',
  '/api/hermes/media/',
]

const BLOCKED_MODEL_WRITES = new Set([
  '/api/hermes/provider-models',
  '/api/hermes/config/model',
  '/api/hermes/model-alias',
  '/api/hermes/model-visibility',
  '/api/hermes/custom-model',
])

const BLOCKED_CONFIG_SECTIONS = new Set([
  'api_key',
  'base_url',
  'custom_providers',
  'default_model',
  'default_provider',
  'model',
  'model_provider',
  'models',
  'provider',
  'providers',
])

function isMutation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
}

function isSessionModelWrite(path: string): boolean {
  return /^\/api\/hermes\/sessions\/[^/]+\/model$/.test(path)
}

export function shouldBlockJellyManagedRequest(method: string, path: string, body?: unknown): boolean {
  if (path.startsWith('/v1/') || path.startsWith('/api/hermes/v1/')) return true
  if (BLOCKED_PREFIXES.some(prefix => path.startsWith(prefix))) return true
  if (isMutation(method) && (BLOCKED_MODEL_WRITES.has(path) || isSessionModelWrite(path))) return true

  if (method === 'PUT' && path === '/api/hermes/config') {
    const section = String((body as any)?.section ?? '').trim().toLowerCase()
    return BLOCKED_CONFIG_SECTIONS.has(section)
  }

  return false
}

function reject(ctx: Context) {
  ctx.status = 403
  ctx.body = {
    code: 'JELLY_MANAGED_MODE',
    error: 'Model providers are managed by JellyAI.',
  }
}

export async function blockManagedModelConfiguration(ctx: Context, next: Next) {
  if (!isJellyManagedMode()) {
    await next()
    return
  }

  if (shouldBlockJellyManagedRequest(ctx.method, ctx.path, (ctx.request as any)?.body)) {
    reject(ctx)
    return
  }

  await next()
}
