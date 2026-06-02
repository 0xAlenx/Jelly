const skillIds = ['logistics-assistant', 'customer-service', 'customer-followup']
const skillNames = { 'logistics-assistant': '物流助手', 'customer-service': '智能客服', 'customer-followup': '客户跟进' }
const state = { token: sessionStorage.getItem('jelly-admin-token') || '', accounts: [], providers: [], models: [], selectedAccount: null }
const $ = selector => document.querySelector(selector)
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const date = value => value ? new Date(value).toLocaleString('zh-CN') : '未设置'
const number = value => Number(value ?? 0).toLocaleString('zh-CN')

async function api(path, init = {}) {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`)
  const response = await fetch(path, { ...init, headers })
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401 && path !== '/api/jelly/admin/auth/login') logout()
  if (!response.ok) throw new Error(payload.code || `HTTP_${response.status}`)
  return payload
}

function showApp() {
  $('#login-view').classList.add('hidden')
  $('#app-view').classList.remove('hidden')
  void Promise.all([loadSummary(), loadAccounts(), loadProviders().then(loadModels)])
}

function logout() {
  state.token = ''
  sessionStorage.removeItem('jelly-admin-token')
  $('#app-view').classList.add('hidden')
  $('#login-view').classList.remove('hidden')
}

async function loadSummary() {
  const summary = await api('/api/jelly/admin/summary')
  $('#stat-accounts').textContent = number(summary.activeAccounts)
  $('#stat-calls').textContent = number(summary.callsToday)
  $('#stat-credits-today').textContent = number(summary.creditsToday)
  $('#stat-credits').textContent = number(summary.creditsBalance)
  $('#gateway-status').textContent = summary.modelGatewayConfigured ? '模型路由已配置' : '模型路由未配置'
}

async function loadAccounts() {
  state.accounts = await api('/api/jelly/admin/accounts')
  $('#account-rows').innerHTML = state.accounts.map(account => `
    <tr><td>${esc(account.name)}</td><td>${esc(account.company_name)}</td><td>${number(account.credits_balance)}</td>
    <td>${esc(date(account.expires_at))}</td><td>${esc(account.status)}</td><td><div class="row-actions"><button class="secondary account-open" data-id="${esc(account.id)}">管理</button><button class="danger account-delete" data-id="${esc(account.id)}" data-name="${esc(account.name)}">删除</button></div></td></tr>
  `).join('') || '<tr><td colspan="6" class="muted">暂无客户</td></tr>'
  document.querySelectorAll('.account-open').forEach(button => button.addEventListener('click', () => void selectAccount(button.dataset.id)))
  document.querySelectorAll('.account-delete').forEach(button => button.addEventListener('click', () => void deleteAccount(button.dataset.id, button.dataset.name)))
}

function collapseAccount() {
  state.selectedAccount = null
  $('#account-detail').classList.add('hidden')
  $('#license-result').classList.add('hidden')
}

async function deleteAccount(id, name) {
  if (!window.confirm(`确认删除客户“${name}”？该客户的授权码、积分流水和调用日志也会一并删除。`)) return
  await api(`/api/jelly/admin/accounts/${id}`, { method: 'DELETE' })
  if (state.selectedAccount?.id === id) collapseAccount()
  await Promise.all([loadAccounts(), loadSummary()])
}

async function selectAccount(id) {
  state.selectedAccount = state.accounts.find(account => account.id === id)
  if (!state.selectedAccount) return
  const account = state.selectedAccount
  $('#account-detail').classList.remove('hidden')
  $('#detail-title').textContent = account.name
  $('#detail-meta').innerHTML = `<p>${esc(account.company_name)}</p><p>剩余积分：<strong>${number(account.credits_balance)}</strong><br>有效期：${esc(date(account.expires_at))}<br>状态：${esc(account.status)}</p>`
  $('#toggle-account').textContent = account.status === 'active' ? '冻结客户' : '恢复客户'
  $('#license-result').classList.add('hidden')
  const [transactions, usage, skills, licenses] = await Promise.all([
    api(`/api/jelly/admin/accounts/${id}/transactions`),
    api(`/api/jelly/admin/accounts/${id}/usage`),
    api(`/api/jelly/admin/accounts/${id}/skills`),
    api(`/api/jelly/admin/accounts/${id}/licenses`),
  ])
  const enabled = new Map(skills.map(skill => [skill.skill_id, skill.enabled]))
  $('#skill-list').innerHTML = skillIds.map(skill => `<label><input type="checkbox" data-skill="${esc(skill)}" ${enabled.get(skill) ? 'checked' : ''}>${esc(skillNames[skill])}</label>`).join('')
  document.querySelectorAll('#skill-list input').forEach(input => input.addEventListener('change', () => void api(`/api/jelly/admin/accounts/${id}/skills/${input.dataset.skill}`, { method: 'PUT', body: JSON.stringify({ enabled: input.checked }) })))
  $('#transaction-rows').innerHTML = transactions.map(row => `<tr><td>${esc(date(row.created_at))}</td><td>${esc(row.type)}</td><td>${number(row.amount)}</td><td>${number(row.balance_after)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">暂无流水</td></tr>'
  $('#usage-rows').innerHTML = usage.map(row => `<tr><td>${esc(date(row.created_at))}</td><td>${esc(row.model)}</td><td>${number(row.total_tokens)}</td><td>${number(row.credits_cost)}</td><td>${esc(row.request_status)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">暂无调用</td></tr>'
  renderLicenses(id, licenses)
}

function renderLicenses(accountId, licenses) {
  $('#license-rows').innerHTML = licenses.map(row => `<tr><td>${esc(row.key_prefix)}</td><td>${esc(row.status)}</td><td>${esc(date(row.expires_at))}</td><td>${esc(date(row.last_used_at))}</td><td><button class="secondary license-toggle" data-id="${esc(row.id)}" data-status="${esc(row.status)}">${row.status === 'active' ? '停用' : '启用'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">暂无授权码</td></tr>'
  document.querySelectorAll('.license-toggle').forEach(button => button.addEventListener('click', async () => {
    const status = button.dataset.status === 'active' ? 'disabled' : 'active'
    await api(`/api/jelly/admin/accounts/${accountId}/licenses/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    renderLicenses(accountId, await api(`/api/jelly/admin/accounts/${accountId}/licenses`))
  }))
}

async function loadModels() {
  state.models = await api('/api/jelly/admin/models')
  $('#model-rows').innerHTML = state.models.map(model => `<tr><td>${esc(model.model)}${model.is_default ? '（主模型）' : ''}</td><td>${esc(model.provider_name || '环境变量')}</td><td>${esc(model.upstream_model)}</td><td>${esc(model.input_token_price)}</td><td>${esc(model.output_token_price)}</td><td>${esc(model.credits_multiplier)}</td><td>${number(model.priority)}</td><td>${model.enabled ? '启用' : '停用'}</td><td><button class="secondary model-edit" data-model="${esc(model.model)}">编辑</button></td></tr>`).join('') || '<tr><td colspan="9" class="muted">暂无模型路由</td></tr>'
  document.querySelectorAll('.model-edit').forEach(button => button.addEventListener('click', () => editModel(button.dataset.model)))
}

async function loadProviders() {
  state.providers = await api('/api/jelly/admin/providers')
  $('#provider-rows').innerHTML = state.providers.map(provider => `<tr><td>${esc(provider.name)}</td><td>${esc(provider.base_url)}</td><td>${provider.api_key_configured ? '已配置' : '未配置'}</td><td>${provider.is_default ? '默认' : '-'}</td><td>${provider.enabled ? '启用' : '停用'}</td><td><button class="secondary provider-edit" data-name="${esc(provider.name)}">编辑</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">暂无供应商，请先新增供应商。</td></tr>'
  $('#model-provider').innerHTML = state.providers.filter(provider => provider.enabled).map(provider => `<option value="${esc(provider.id)}">${esc(provider.name)}${provider.is_default ? '（默认）' : ''}</option>`).join('')
  document.querySelectorAll('.provider-edit').forEach(button => button.addEventListener('click', () => editProvider(button.dataset.name)))
}

function editProvider(name) {
  const provider = state.providers.find(item => item.name === name)
  if (!provider) return
  const form = $('#provider-form')
  form.elements.name.value = provider.name
  form.elements.baseUrl.value = provider.base_url
  form.elements.apiKey.value = ''
  form.elements.enabled.checked = provider.enabled
  form.elements.isDefault.checked = provider.is_default
  form.elements.name.focus()
}

function editModel(name) {
  const model = state.models.find(item => item.model === name)
  if (!model) return
  const form = $('#model-form')
  form.elements.model.value = model.model
  form.elements.providerId.value = model.provider_id || ''
  form.elements.upstreamModel.value = model.upstream_model
  form.elements.inputTokenPrice.value = model.input_token_price
  form.elements.outputTokenPrice.value = model.output_token_price
  form.elements.creditsMultiplier.value = model.credits_multiplier
  form.elements.priority.value = model.priority
  form.elements.enabled.checked = model.enabled
  form.elements.isDefault.checked = model.is_default
  form.elements.model.focus()
}

function formResult(selector, message, failed = false) {
  const target = $(selector)
  target.textContent = message
  target.classList.toggle('error', failed)
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault()
  $('#login-error').textContent = ''
  try {
    const form = new FormData(event.currentTarget)
    const data = await api('/api/jelly/admin/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) })
    state.token = data.accessToken
    sessionStorage.setItem('jelly-admin-token', state.token)
    showApp()
  } catch (error) {
    $('#login-error').textContent = error.message
  }
})
$('#logout').addEventListener('click', logout)
document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-button').forEach(item => item.classList.toggle('active', item === button))
  document.querySelectorAll('.page').forEach(page => page.classList.toggle('hidden', page.id !== button.dataset.target))
}))
$('#show-create-account').addEventListener('click', () => $('#create-account-panel').classList.toggle('hidden'))
$('#create-account-form').addEventListener('submit', async event => {
  event.preventDefault()
  const form = event.currentTarget
  try {
    const input = Object.fromEntries(new FormData(form))
    const created = await api('/api/jelly/admin/accounts', { method: 'POST', body: JSON.stringify(input) })
    form.reset()
    $('#account-create-result').textContent = `客户已创建并保存。固定授权码如下，可在客户管理中再次查看：\n${created.licenseKey}`
    $('#account-create-result').classList.remove('hidden')
    await Promise.all([loadAccounts(), loadSummary()])
  } catch (error) {
    $('#account-create-result').textContent = `创建失败：${error.message}`
    $('#account-create-result').classList.remove('hidden')
  }
})
$('#credit-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (!state.selectedAccount) return
  const form = event.currentTarget
  await api(`/api/jelly/admin/accounts/${state.selectedAccount.id}/credits`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) })
  form.reset()
  await Promise.all([loadAccounts(), loadSummary()])
  await selectAccount(state.selectedAccount.id)
})
$('#issue-license').addEventListener('click', async () => {
  const result = await api(`/api/jelly/admin/accounts/${state.selectedAccount.id}/licenses`, { method: 'POST', body: '{}' })
  $('#license-result').textContent = `客户固定授权码：\n${result.licenseKey}`
  $('#license-result').classList.remove('hidden')
  renderLicenses(state.selectedAccount.id, await api(`/api/jelly/admin/accounts/${state.selectedAccount.id}/licenses`))
})
$('#collapse-account').addEventListener('click', collapseAccount)
$('#toggle-account').addEventListener('click', async () => {
  const next = state.selectedAccount.status === 'active' ? 'disabled' : 'active'
  await api(`/api/jelly/admin/accounts/${state.selectedAccount.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) })
  await loadAccounts()
  await selectAccount(state.selectedAccount.id)
})
$('#model-form').addEventListener('submit', async event => {
  event.preventDefault()
  const formElement = event.currentTarget
  try {
    const form = new FormData(formElement)
    const input = Object.fromEntries(form)
    input.enabled = form.has('enabled')
    input.isDefault = form.has('isDefault')
    await api(`/api/jelly/admin/models/${encodeURIComponent(input.model)}`, { method: 'PUT', body: JSON.stringify(input) })
    await loadModels()
    formResult('#model-save-result', '模型路由已保存，新的对话请求会立即使用该配置。')
  } catch (error) {
    formResult('#model-save-result', `保存失败：${error.message}`, true)
  }
})

$('#provider-form').addEventListener('submit', async event => {
  event.preventDefault()
  const formElement = event.currentTarget
  try {
    const form = new FormData(formElement)
    const input = Object.fromEntries(form)
    input.enabled = form.has('enabled')
    input.isDefault = form.has('isDefault')
    await api(`/api/jelly/admin/providers/${encodeURIComponent(input.name)}`, { method: 'PUT', body: JSON.stringify(input) })
    formElement.elements.apiKey.value = ''
    await loadProviders()
    await loadModels()
    formResult('#provider-save-result', '供应商已保存。API Key 已加密写入后端。')
  } catch (error) {
    formResult('#provider-save-result', `保存失败：${error.message}`, true)
  }
})

if (state.token) showApp()
