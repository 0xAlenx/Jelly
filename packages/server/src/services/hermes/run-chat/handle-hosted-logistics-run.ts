import { randomUUID } from 'crypto'
import type { Server, Socket } from 'socket.io'
import { addMessage, createSession, getSession, updateSessionStats } from '../../../db/hermes/session-store'
import { hostedCloudFetch } from '../../jellyai/device-session'
import { hostedAccountIdFromUsername, isJellyWebHostedMode } from '../../jellyai/web-hosted-mode'
import { logger } from '../../logger'
import { contentBlocksToString, extractTextForPreview } from './content-blocks'
import { shouldRouteHostedLogisticsQuote } from './logistics-quote-routing'
import type { ContentBlock, SessionState } from './types'

interface HostedLogisticsRunData {
  input: string | ContentBlock[]
  display_input?: string | ContentBlock[] | null
  display_role?: 'user' | 'command'
  session_id?: string
  queue_id?: string
  peerExcludeSocketId?: string
}

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error)
  if (code.includes('SKILL_NOT_ENTITLED')) return '当前账号未开通物流报价 Skill，请联系管理员。'
  if (code.includes('HOSTED_SESSION_REQUIRED')) return '登录状态已失效，请退出后重新登录。'
  return `物流报价暂时无法执行：${code}`
}

async function cloudReply(accountId: string, message: string): Promise<string> {
  const response = await hostedCloudFetch(accountId, '/api/jelly/web/skills/logistics-quote/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  const payload = await response.json() as { reply?: unknown; code?: unknown; error?: unknown }
  if (!response.ok) throw new Error(String(payload.code || payload.error || 'LOGISTICS_QUOTE_FAILED'))
  const reply = String(payload.reply ?? '').trim()
  if (!reply) throw new Error('LOGISTICS_QUOTE_EMPTY_RESPONSE')
  return reply
}

export async function handleHostedLogisticsQuoteRun(args: {
  nsp: ReturnType<Server['of']>
  socket: Socket
  data: HostedLogisticsRunData
  profile: string
  sessionMap: Map<string, SessionState>
  skipUserMessage?: boolean
  dequeueNextQueuedRun: (socket: Socket, sessionId: string, fallbackProfile?: string) => void
}): Promise<boolean> {
  const { nsp, socket, data, profile, sessionMap, skipUserMessage = false, dequeueNextQueuedRun } = args
  if (!isJellyWebHostedMode() || !data.session_id || !shouldRouteHostedLogisticsQuote(data.input)) return false

  const accountId = hostedAccountIdFromUsername(String(socket.data.user?.username ?? ''))
  if (!accountId) return false

  const sessionId = data.session_id
  const input = contentBlocksToString(data.input).trim()
  const displayInput = data.display_input === undefined ? data.input : data.display_input
  const displayText = displayInput == null ? '' : contentBlocksToString(displayInput)
  const displayRole = data.display_role === 'command' ? 'command' : 'user'
  const runId = `logistics_quote_${randomUUID()}`
  const now = Math.floor(Date.now() / 1000)
  const state = sessionMap.get(sessionId) ?? { messages: [], isWorking: false, events: [], queue: [] }
  sessionMap.set(sessionId, state)

  state.isWorking = true
  state.isAborting = false
  state.events = []
  state.profile = profile
  state.source = 'cli'
  state.activeRunMarker = runId
  state.runId = runId
  socket.join(`session:${sessionId}`)

  const emit = (event: string, payload: any) => {
    const tagged = { ...payload, session_id: sessionId }
    nsp.to(`session:${sessionId}`).emit(event, tagged)
    if (!nsp.adapter.rooms.get(`session:${sessionId}`)?.size && socket.connected) socket.emit(event, tagged)
  }

  if (!getSession(sessionId)) {
    const preview = extractTextForPreview(displayInput ?? data.input).replace(/[\r\n]/g, ' ').substring(0, 100)
    createSession({ id: sessionId, profile, source: 'cli', title: preview })
  }

  if (!skipUserMessage && displayInput !== null) {
    state.messages.push({
      id: state.messages.length + 1,
      session_id: sessionId,
      runMarker: runId,
      role: displayRole,
      content: displayText,
      timestamp: now,
    })
    const messageId = addMessage({ session_id: sessionId, role: displayRole, content: displayText, timestamp: now })
    const peerTarget = data.peerExcludeSocketId
      ? nsp.to(`session:${sessionId}`).except(data.peerExcludeSocketId)
      : socket.to(`session:${sessionId}`)
    peerTarget.emit('run.peer_user_message', {
      event: 'run.peer_user_message',
      session_id: sessionId,
      message: { id: data.queue_id || messageId, role: displayRole, content: displayText, timestamp: now },
    })
  }

  emit('run.started', { event: 'run.started', run_id: runId, skill_id: 'logistics-assistant' })
  logger.info('[chat-run-socket] hosted logistics quote started for account %s session %s', accountId, sessionId)

  try {
    const reply = await cloudReply(accountId, input)
    const assistantTimestamp = Math.floor(Date.now() / 1000)
    const assistantMessage = {
      id: state.messages.length + 1,
      session_id: sessionId,
      runMarker: runId,
      role: 'assistant',
      content: reply,
      timestamp: assistantTimestamp,
      finish_reason: 'stop',
    }
    state.messages.push(assistantMessage)
    addMessage({
      session_id: sessionId,
      role: 'assistant',
      content: reply,
      timestamp: assistantTimestamp,
      finish_reason: 'stop',
    })
    updateSessionStats(sessionId)
    emit('message.delta', { event: 'message.delta', run_id: runId, delta: reply, output: reply })
    emit('run.completed', {
      event: 'run.completed',
      run_id: runId,
      output: reply,
      result: { final_response: reply, skill_id: 'logistics-assistant' },
      queue_remaining: state.queue.length,
    })
  } catch (error) {
    const message = errorMessage(error)
    logger.warn(error, '[chat-run-socket] hosted logistics quote failed for account %s session %s', accountId, sessionId)
    emit('run.failed', { event: 'run.failed', run_id: runId, error: message, queue_remaining: state.queue.length })
  } finally {
    state.runId = undefined
    state.activeRunMarker = undefined
    state.events = []
    state.profile = state.queue.length > 0 ? state.queue[0]?.profile || profile : undefined
    state.source = state.queue.length > 0 ? state.queue[0]?.source : state.source
    state.isWorking = state.queue.length > 0
    if (state.queue.length > 0) dequeueNextQueuedRun(socket, sessionId, profile)
  }

  return true
}
