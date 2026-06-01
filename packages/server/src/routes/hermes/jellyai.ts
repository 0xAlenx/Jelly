import Router from '@koa/router'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { config } from '../../config'

interface JellyAIModel {
  id: string
  provider: string
  name: string
  costMultiplier: number
  enabled: boolean
  default: boolean
  note: string
  apiKey?: string
}

interface JellyAIState {
  summary: {
    activeUsers: number
    modelCallsToday: number
    todayCredits: number
    gatewayStatus: string
  }
  user: {
    name: string
    licenseKey: string
    expiresAt: string
    credits: number
    todayCost: number
    plan: string
    status: string
    skills: string[]
  }
  models: JellyAIModel[]
  ledger: Array<{
    delta: number
    message: string
    time: string
  }>
  updatedAt: string
}

const DEFAULT_STATE: JellyAIState = {
  summary: {
    activeUsers: 128,
    modelCallsToday: 3482,
    todayCredits: 315,
    gatewayStatus: '运行中',
  },
  user: {
    name: '广州迅达物流',
    licenseKey: 'JAI-LG-84K2-2026',
    expiresAt: '2026-06-30',
    credits: 10000,
    todayCost: 315,
    plan: '物流行业试用版',
    status: '正常',
    skills: ['物流助手', '智能客服', '客户跟进'],
  },
  models: [
    {
      id: 'jelly-logistics-pro',
      provider: 'JellyAI Gateway',
      name: 'jelly-logistics-pro',
      costMultiplier: 1,
      enabled: true,
      default: true,
      note: '物流助手、智能客服、客户跟进默认使用。',
    },
    {
      id: 'jelly-fast-chat',
      provider: 'JellyAI Gateway',
      name: 'jelly-fast-chat',
      costMultiplier: 0.6,
      enabled: true,
      default: false,
      note: '低成本客服回复和普通问答。',
    },
    {
      id: 'jelly-reasoning-plus',
      provider: 'Private Pool',
      name: 'jelly-reasoning-plus',
      costMultiplier: 2.5,
      enabled: false,
      default: false,
      note: '复杂总结、异常件分析、合同类咨询。',
    },
  ],
  ledger: [
    { delta: 10000, message: '新用户开通物流行业试用版', time: '今天 09:20' },
    { delta: -315, message: 'AI 对话与物流助手调用消耗', time: '今天 11:48' },
    { delta: -85, message: '智能客服自动回复消耗', time: '今天 12:10' },
  ],
  updatedAt: new Date().toISOString(),
}

const jellyaiDataFile = join(config.appHome, 'jellyai-state.json')

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function slugify(value: string): string {
  return String(value || 'model')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'model'
}

function formatLocalTime(): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

function maskKey(apiKey?: string): string {
  if (!apiKey) return ''
  if (apiKey.length <= 8) return '****'
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
}

function normalizeState(raw?: Partial<JellyAIState>): JellyAIState {
  const state = Object.assign(clone(DEFAULT_STATE), raw || {}) as JellyAIState
  state.summary = Object.assign(clone(DEFAULT_STATE.summary), raw?.summary || {})
  state.user = Object.assign(clone(DEFAULT_STATE.user), raw?.user || {})
  state.models = Array.isArray(raw?.models) && raw.models.length ? raw.models : clone(DEFAULT_STATE.models)
  state.ledger = Array.isArray(raw?.ledger) ? raw.ledger : clone(DEFAULT_STATE.ledger)

  state.user.credits = Math.max(0, Number(state.user.credits) || 0)
  state.user.todayCost = Math.max(0, Number(state.user.todayCost) || 0)
  state.summary.todayCredits = Math.max(0, Number(state.summary.todayCredits) || state.user.todayCost || 0)
  state.summary.activeUsers = Math.max(0, Number(state.summary.activeUsers) || 0)
  state.summary.modelCallsToday = Math.max(0, Number(state.summary.modelCallsToday) || 0)

  state.models = state.models.map((model, index) => ({
    ...model,
    id: slugify(model?.id || model?.name || `model-${index}`),
    provider: model.provider ?? 'JellyAI Gateway',
    name: model.name ?? 'jelly-model',
    costMultiplier: model.costMultiplier ?? 1,
    enabled: model.enabled ?? true,
    default: model.default ?? false,
    note: model.note ?? '由 JellyAI 统一模型网关提供。',
  }))

  if (!state.models.some(model => model.default) && state.models.length) {
    state.models[0].default = true
  }

  return state
}

function readState(): JellyAIState {
  mkdirSync(dirname(jellyaiDataFile), { recursive: true })
  try {
    return normalizeState(JSON.parse(readFileSync(jellyaiDataFile, 'utf-8')))
  } catch {
    return writeState(DEFAULT_STATE)
  }
}

function writeState(state: JellyAIState): JellyAIState {
  mkdirSync(dirname(jellyaiDataFile), { recursive: true })
  const nextState = normalizeState(state)
  nextState.updatedAt = new Date().toISOString()
  writeFileSync(jellyaiDataFile, JSON.stringify(nextState, null, 2))
  return nextState
}

function publicModel(model: JellyAIModel) {
  const copy: any = { ...model, hasKey: Boolean(model.apiKey), maskedKey: maskKey(model.apiKey) }
  delete copy.apiKey
  return copy
}

function publicState(state: JellyAIState) {
  return {
    ...normalizeState(state),
    models: state.models.map(publicModel),
    dataFile: jellyaiDataFile,
  }
}

export const jellyaiRoutes = new Router()

jellyaiRoutes.get('/api/jellyai/state', (ctx) => {
  ctx.set('Cache-Control', 'no-store')
  ctx.body = publicState(readState())
})

jellyaiRoutes.get('/api/jellyai/me', (ctx) => {
  ctx.set('Cache-Control', 'no-store')
  const state = readState()
  const defaultModel = state.models.find(model => model.default) || state.models[0] || null
  ctx.body = {
    ...state.user,
    summary: state.summary,
    model: defaultModel ? publicModel(defaultModel) : null,
    updatedAt: state.updatedAt,
  }
})

jellyaiRoutes.post('/api/jellyai/admin/credits', (ctx) => {
  ctx.set('Cache-Control', 'no-store')
  const body = (ctx.request.body || {}) as { delta?: number, message?: string }
  const delta = Number(body.delta)
  if (!Number.isFinite(delta) || delta === 0) {
    ctx.status = 400
    ctx.body = { error: 'Invalid credit delta' }
    return
  }

  const state = readState()
  const before = state.user.credits
  state.user.credits = Math.max(0, before + delta)
  const actualDelta = state.user.credits - before
  if (actualDelta < 0) {
    state.user.todayCost += Math.abs(actualDelta)
    state.summary.todayCredits += Math.abs(actualDelta)
  }
  state.ledger.unshift({
    delta: actualDelta,
    message: body.message || (actualDelta > 0 ? '管理员增加积分' : '管理员扣减积分'),
    time: `今天 ${formatLocalTime()}`,
  })
  state.ledger = state.ledger.slice(0, 50)
  ctx.body = publicState(writeState(state))
})

jellyaiRoutes.post('/api/jellyai/admin/models', (ctx) => {
  ctx.set('Cache-Control', 'no-store')
  const body = (ctx.request.body || {}) as Partial<JellyAIModel>
  const name = String(body.name || '').trim()
  if (!name) {
    ctx.status = 400
    ctx.body = { error: 'Model name is required' }
    return
  }

  const state = readState()
  const id = String(body.id || slugify(name)).trim()
  const existing = state.models.find(model => model.id === id || model.name === name)
  const nextModel: JellyAIModel = {
    ...(existing || {}),
    id: existing?.id || id,
    provider: String(body.provider || existing?.provider || 'JellyAI Gateway').trim(),
    name,
    costMultiplier: Number(body.costMultiplier) > 0 ? Number(body.costMultiplier) : 1,
    enabled: body.enabled !== false,
    default: Boolean(body.default),
    note: String(body.note || existing?.note || '由 JellyAI 统一模型网关提供。').trim(),
  }

  if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    nextModel.apiKey = body.apiKey.trim()
  }

  if (nextModel.default) state.models.forEach(model => { model.default = false })
  if (existing) Object.assign(existing, nextModel)
  else state.models.push(nextModel)
  if (!state.models.some(model => model.default) && state.models.length) state.models[0].default = true

  ctx.body = publicState(writeState(state))
})

jellyaiRoutes.post('/api/jellyai/admin/models/default', (ctx) => {
  ctx.set('Cache-Control', 'no-store')
  const body = (ctx.request.body || {}) as { id?: string, name?: string }
  const state = readState()
  const target = state.models.find(model => model.id === body.id || model.name === body.name)
  if (!target) {
    ctx.status = 404
    ctx.body = { error: 'Model not found' }
    return
  }
  state.models.forEach(model => { model.default = model.id === target.id })
  ctx.body = publicState(writeState(state))
})

jellyaiRoutes.post('/api/jellyai/admin/models/toggle', (ctx) => {
  ctx.set('Cache-Control', 'no-store')
  const body = (ctx.request.body || {}) as { id?: string, name?: string, enabled?: boolean }
  const state = readState()
  const target = state.models.find(model => model.id === body.id || model.name === body.name)
  if (!target) {
    ctx.status = 404
    ctx.body = { error: 'Model not found' }
    return
  }
  target.enabled = Boolean(body.enabled)
  ctx.body = publicState(writeState(state))
})

jellyaiRoutes.post('/api/jellyai/admin/reset', (ctx) => {
  ctx.set('Cache-Control', 'no-store')
  ctx.body = publicState(writeState(clone(DEFAULT_STATE)))
})
