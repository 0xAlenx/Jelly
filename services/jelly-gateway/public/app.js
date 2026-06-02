const sessionKey = 'jelly-web-session'
const skillNames = {
  'logistics-assistant': '物流助手',
  'customer-service': '智能客服',
  'customer-followup': '客户跟进',
}
const state = {
  session: readSession(),
  refreshTimer: 0,
  refreshing: null,
  account: null,
  sessions: [],
  activeSessionId: null,
  messages: [],
  sending: false,
  chatMode: 'chat',
}
const $ = selector => document.querySelector(selector)
const number = value => Number(value ?? 0).toLocaleString('zh-CN')
const date = value => value ? new Date(value).toLocaleDateString('zh-CN') : '长期有效'

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(sessionKey) || 'null')
  } catch {
    return null
  }
}

function saveSession(session) {
  state.session = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: Date.now() + Number(session.expiresIn ?? 0) * 1000,
  }
  sessionStorage.setItem(sessionKey, JSON.stringify(state.session))
  scheduleRefresh()
}

function clearSession() {
  state.session = null
  sessionStorage.removeItem(sessionKey)
  window.clearTimeout(state.refreshTimer)
  state.refreshTimer = 0
}

function scheduleRefresh() {
  window.clearTimeout(state.refreshTimer)
  if (!state.session) return
  const delay = Math.max(1000, state.session.expiresAt - Date.now() - 60_000)
  state.refreshTimer = window.setTimeout(() => void refreshSession(), delay)
}

async function json(path, init = {}) {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (state.session?.accessToken) headers.set('Authorization', `Bearer ${state.session.accessToken}`)
  const response = await fetch(path, { ...init, headers })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.code || `HTTP_${response.status}`)
  return payload
}

async function refreshSession() {
  if (!state.session?.refreshToken) throw new Error('LOGIN_REQUIRED')
  if (state.refreshing) return state.refreshing
  state.refreshing = (async () => {
    try {
      const response = await fetch('/api/jelly/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: state.session.refreshToken }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.code || `HTTP_${response.status}`)
      saveSession(payload)
      return payload
    } catch (error) {
      clearSession()
      showLogin(error.message === 'INVALID_REFRESH_TOKEN' ? '' : error.message)
      throw error
    } finally {
      state.refreshing = null
    }
  })()
  return state.refreshing
}

async function accountApi(path, init = {}, retried = false) {
  try {
    return await json(path, init)
  } catch (error) {
    if (!retried && error.message === 'UNAUTHORIZED' && state.session?.refreshToken) {
      await refreshSession()
      return accountApi(path, init, true)
    }
    throw error
  }
}

async function accountFetch(path, init = {}, retried = false) {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (state.session?.accessToken) headers.set('Authorization', `Bearer ${state.session.accessToken}`)
  const response = await fetch(path, { ...init, headers })
  if (!retried && response.status === 401 && state.session?.refreshToken) {
    await refreshSession()
    return accountFetch(path, init, true)
  }
  return response
}

function showLogin(message = '') {
  $('#app-view').classList.add('hidden')
  $('#login-view').classList.remove('hidden')
  $('#login-error').textContent = errorText(message)
}

function showApp(account) {
  state.account = account
  $('#login-view').classList.add('hidden')
  $('#app-view').classList.remove('hidden')
  $('#account-name').textContent = account.name
  $('#company-name').textContent = account.companyName
  $('#credits-balance').textContent = number(account.creditsBalance)
  $('#chat-credits-balance').textContent = number(account.creditsBalance)
  $('#credits-today').textContent = number(account.creditsToday)
  $('#expires-at').textContent = date(account.expiresAt)
  $('#skill-list').innerHTML = account.skills.length
    ? account.skills.map(skill => `<span class="skill">${escapeHtml(skillNames[skill] || skill)}</span>`).join('')
    : '<span class="muted">暂未开通 Skill</span>'
  const logistics = document.querySelector('.mode-button[data-mode="logistics-quote"]')
  logistics.disabled = !account.skills.includes('logistics-assistant')
  logistics.title = logistics.disabled ? '当前授权未开通物流助手' : ''
  if (logistics.disabled && state.chatMode === 'logistics-quote') setChatMode('chat')
}

function showPage(target) {
  document.querySelectorAll('.page').forEach(page => page.classList.toggle('hidden', page.id !== target))
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.target === target))
}

async function loadSessions() {
  state.sessions = await accountApi('/api/jelly/web/sessions')
  renderSessions()
}

function renderSessions() {
  const target = $('#session-list')
  target.innerHTML = state.sessions.length
    ? state.sessions.map(session => `
      <div class="session-item">
        <button class="session-open ${session.id === state.activeSessionId ? 'active' : ''}" type="button" data-id="${escapeHtml(session.id)}" title="${escapeHtml(session.title)}">${escapeHtml(session.title)}</button>
        <button class="session-delete" type="button" data-id="${escapeHtml(session.id)}" title="删除对话">×</button>
      </div>`).join('')
    : '<span class="history-empty">暂无历史对话</span>'
  document.querySelectorAll('.session-open').forEach(button => button.addEventListener('click', () => void selectSession(button.dataset.id)))
  document.querySelectorAll('.session-delete').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation()
    void deleteSession(button.dataset.id)
  }))
}

async function ensureSession(title) {
  if (state.activeSessionId) return state.activeSessionId
  const session = await accountApi('/api/jelly/web/sessions', {
    method: 'POST',
    body: JSON.stringify({ title: title.slice(0, 30) }),
  })
  state.activeSessionId = session.id
  await loadSessions()
  return session.id
}

async function persistMessage(message) {
  if (!state.activeSessionId) throw new Error('WEB_CHAT_SESSION_REQUIRED')
  await accountApi(`/api/jelly/web/sessions/${encodeURIComponent(state.activeSessionId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role: message.role, content: message.content }),
  })
}

async function selectSession(sessionId) {
  if (state.sending || sessionId === state.activeSessionId) return
  const messages = await accountApi(`/api/jelly/web/sessions/${encodeURIComponent(sessionId)}/messages`)
  state.activeSessionId = sessionId
  state.messages = messages.map(message => ({
    role: message.role,
    content: message.content,
    rawContent: message.content,
  }))
  $('#chat-error').textContent = ''
  renderSessions()
  renderMessages()
  showPage('chat-page')
}

async function deleteSession(sessionId) {
  if (state.sending || !window.confirm('确认删除这条对话记录？')) return
  await accountApi(`/api/jelly/web/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
  if (sessionId === state.activeSessionId) startNewChat()
  await loadSessions()
}

function startNewChat() {
  if (state.sending) return
  state.activeSessionId = null
  state.messages = []
  $('#chat-error').textContent = ''
  renderSessions()
  renderMessages()
  showPage('chat-page')
  $('#chat-input').focus()
}

function createMessage(role, content = '') {
  const message = { role, content, rawContent: content }
  state.messages.push(message)
  renderMessages()
  return message
}

function renderMessages() {
  const target = $('#messages')
  if (!state.messages.length) {
    target.innerHTML = `
      <div id="empty-chat" class="empty-chat">
        <img src="/jellyai-logo.png" alt="">
        <h2>开始新的对话</h2>
        <p>输入问题后，消息将通过 JellyAI 云端模型网关处理。</p>
      </div>`
    return
  }
  target.innerHTML = state.messages.map((message, index) => `
    <div class="message ${escapeHtml(message.role)} ${state.sending && index === state.messages.length - 1 && message.role === 'assistant' ? 'pending' : ''}">
      <div class="bubble">${escapeHtml(message.content || (message.role === 'assistant' ? '正在生成回复' : ''))}</div>
    </div>
  `).join('')
  target.scrollTop = target.scrollHeight
}

function streamedText(payload) {
  const choice = payload?.choices?.[0]
  const delta = choice?.delta?.content ?? choice?.message?.content
  if (typeof delta === 'string') return delta
  if (!Array.isArray(delta)) return ''
  return delta.map(item => typeof item === 'string' ? item : String(item?.text ?? '')).join('')
}

function visibleAssistantText(value) {
  return String(value ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trimStart()
}

async function chatError(response) {
  const payload = await response.json().catch(() => ({}))
  throw new Error(payload.code || `HTTP_${response.status}`)
}

async function streamReply() {
  const response = await accountFetch('/api/jelly/chat', {
    method: 'POST',
    body: JSON.stringify({
      messages: state.messages.filter(message => message.content).map(message => ({
        role: message.role,
        content: message.content,
      })),
      stream: true,
    }),
  })
  if (!response.ok) return chatError(response)
  if (!response.body) throw new Error('STREAM_BODY_MISSING')

  const assistant = createMessage('assistant')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  function consume(lines) {
    for (const line of lines) {
      const raw = line.startsWith('data:') ? line.slice(5).trim() : ''
      if (!raw || raw === '[DONE]') continue
      try {
        assistant.rawContent += streamedText(JSON.parse(raw))
        assistant.content = visibleAssistantText(assistant.rawContent)
        renderMessages()
      } catch {
        // Preserve a usable conversation when an upstream emits non-JSON events.
      }
    }
  }
  while (!finished) {
    const chunk = await reader.read()
    finished = chunk.done
    buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !finished })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    consume(lines)
  }
  if (buffer) consume([buffer])
  if (!assistant.content) assistant.content = '模型已完成处理，但没有返回文本内容。'
  renderMessages()
  return assistant
}

async function logisticsQuoteReply(message) {
  const payload = await accountApi('/api/jelly/web/skills/logistics-quote/run', {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
  return createMessage('assistant', payload.reply)
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
}

function errorText(code) {
  return {
    INVALID_LICENSE: '授权码无效、已停用或已过期。',
    LICENSE_KEY_REQUIRED: '请输入授权码。',
    INVALID_REFRESH_TOKEN: '登录已失效，请重新输入授权码。',
    ACCOUNT_DISABLED: '当前客户已停用，请联系管理员。',
    LICENSE_EXPIRED: '授权已过期，请联系管理员。',
    UNAUTHORIZED: '登录已失效，请重新输入授权码。',
    INSUFFICIENT_CREDITS: '积分不足，请联系管理员充值。',
    MODEL_GATEWAY_NOT_CONFIGURED: '模型网关尚未配置，请联系管理员。',
    STREAM_BODY_MISSING: '模型没有返回可读取的流式内容。',
  }[code] || (code ? `登录失败：${code}` : '')
}

async function loadAccount() {
  const account = await accountApi('/api/jelly/me')
  showApp(account)
}

function chatErrorText(code) {
  if (code.startsWith('ALL_MODELS_FAILED')) return '当前模型暂时不可用，请稍后重试或联系管理员。'
  return {
    INSUFFICIENT_CREDITS: '积分不足，请联系管理员充值。',
    MODEL_GATEWAY_NOT_CONFIGURED: '模型网关尚未配置，请联系管理员。',
    STREAM_BODY_MISSING: '模型没有返回可读取的内容，请稍后重试。',
    UNAUTHORIZED: '登录已失效，请重新登录。',
    SKILL_NOT_ENTITLED: '当前授权未开通物流助手，请联系管理员。',
    LOGISTICS_QUOTE_WORKER_NOT_CONFIGURED: '物流报价服务尚未配置，请联系管理员。',
    LOGISTICS_QUOTE_FAILED: '物流报价服务暂时不可用，请稍后重试。',
  }[code] || `发送失败：${code}`
}

function setChatMode(mode) {
  if (state.sending) return
  state.chatMode = mode
  document.querySelectorAll('.mode-button').forEach(button => button.classList.toggle('active', button.dataset.mode === mode))
  $('#chat-mode-description').textContent = mode === 'logistics-quote'
    ? '查询物流成本方案，并支持后续输入毛利率生成客户报价。'
    : '模型由 JellyAI 云端统一管理。'
  $('#chat-input').placeholder = mode === 'logistics-quote'
    ? '输入物流询价，例如：LAX9，300kg，深圳仓，包税'
    : '输入消息，Enter 发送，Shift+Enter 换行'
  $('#chat-input').focus()
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault()
  const form = event.currentTarget
  const button = form.querySelector('button')
  button.disabled = true
  $('#login-error').textContent = ''
  try {
    const input = Object.fromEntries(new FormData(form))
    const session = await json('/api/jelly/auth/license-login', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    saveSession(session)
    form.reset()
    await loadAccount()
    await loadSessions()
  } catch (error) {
    clearSession()
    showLogin(error.message)
  } finally {
    button.disabled = false
  }
})

$('#logout').addEventListener('click', async () => {
  const refreshToken = state.session?.refreshToken
  clearSession()
  showLogin()
  if (!refreshToken) return
  await fetch('/api/jelly/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  }).catch(() => {})
})

document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => showPage(button.dataset.target)))
document.querySelectorAll('.mode-button').forEach(button => button.addEventListener('click', () => {
  if (!button.disabled) setChatMode(button.dataset.mode)
}))

$('#new-chat').addEventListener('click', startNewChat)
$('#sidebar-new-chat').addEventListener('click', startNewChat)

$('#chat-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (state.sending) return
  const input = $('#chat-input')
  const text = input.value.trim()
  if (!text) return
  state.sending = true
  input.value = ''
  input.disabled = true
  $('#send-message').disabled = true
  $('#chat-error').textContent = ''
  const userMessage = createMessage('user', text)
  try {
    await ensureSession(text)
    await persistMessage(userMessage)
    const assistantMessage = state.chatMode === 'logistics-quote'
      ? await logisticsQuoteReply(text)
      : await streamReply()
    await persistMessage(assistantMessage)
    await Promise.all([loadAccount(), loadSessions()])
  } catch (error) {
    $('#chat-error').textContent = chatErrorText(error.message)
  } finally {
    state.sending = false
    input.disabled = false
    $('#send-message').disabled = false
    renderMessages()
    input.focus()
  }
})

$('#chat-input').addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  $('#chat-form').requestSubmit()
})

async function bootstrap() {
  if (!state.session?.refreshToken) return showLogin()
  try {
    await refreshSession()
    await loadAccount()
    await loadSessions()
  } catch {
    showLogin()
  }
}

void bootstrap()
