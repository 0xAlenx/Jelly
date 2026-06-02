import { randomBytes, timingSafeEqual } from 'crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { config } from '../../config'

interface DeviceSession {
  accountId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  mode: 'direct' | 'device'
}

interface HostedSession extends DeviceSession {
  localProxySecret: string
}

interface CloudSessionResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

const DEVICE_SESSION_FILE = join(config.appHome, 'jellyai-device-session.json')
const ACTIVATED_DEVICE_SESSION_FILE = join(config.appHome, 'jellyai-activated-device-session.json')
const DEVICE_TENANT_FILE = join(config.appHome, 'jellyai-device-tenant.json')
const LOCAL_PROXY_SECRET_FILE = join(config.appHome, '.jellyai-local-proxy-secret')
const HOSTED_SESSION_DIR = join(config.appHome, 'jellyai-hosted-sessions')

function gatewayUrl(): string {
  const url = String(process.env.JELLY_GATEWAY_URL ?? '').trim().replace(/\/+$/, '')
  if (!url) throw new Error('JELLY_GATEWAY_URL_REQUIRED')
  return url
}

async function readSession(file = DEVICE_SESSION_FILE): Promise<DeviceSession | null> {
  try {
    const session = JSON.parse(await readFile(file, 'utf8')) as DeviceSession
    const accountId = session.accountId || accountIdFromAccessToken(session.accessToken)
    await bindDeviceTenant(accountId)
    return { ...session, accountId }
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

export async function requireActivatedDeviceSession(): Promise<void> {
  const session = await readSession(ACTIVATED_DEVICE_SESSION_FILE)
  if (!session || session.mode !== 'device') throw new Error('DEVICE_ACTIVATION_REQUIRED')
}

async function writeSession(session: DeviceSession, file = DEVICE_SESSION_FILE) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(session, null, 2), { mode: 0o600 })
}

function hostedSessionFile(accountId: string): string {
  const name = String(accountId || '').replace(/[^a-zA-Z0-9_-]/g, '')
  if (!name) throw new Error('INVALID_JELLY_ACCOUNT_ID')
  return join(HOSTED_SESSION_DIR, `${name}.json`)
}

async function readHostedSession(accountId: string): Promise<HostedSession | null> {
  try {
    const session = JSON.parse(await readFile(hostedSessionFile(accountId), 'utf8')) as HostedSession
    if (!session.localProxySecret || session.accountId !== accountId) return null
    return session
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

async function writeHostedSession(session: HostedSession) {
  await mkdir(HOSTED_SESSION_DIR, { recursive: true })
  await writeFile(hostedSessionFile(session.accountId), JSON.stringify(session, null, 2), { mode: 0o600 })
}

function secureEqual(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left)
    const b = Buffer.from(right)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function normalizeSession(data: CloudSessionResponse, mode: DeviceSession['mode']): DeviceSession {
  return {
    accountId: accountIdFromAccessToken(data.accessToken),
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
    mode,
  }
}

function accountIdFromAccessToken(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8')) as { sub?: unknown }
    const accountId = String(payload.sub ?? '').trim()
    if (accountId) return accountId
  } catch {
    // The cloud response must contain a JWT-shaped access token.
  }
  throw new Error('INVALID_JELLY_ACCESS_TOKEN')
}

async function bindDeviceTenant(accountId: string): Promise<void> {
  await mkdir(dirname(DEVICE_TENANT_FILE), { recursive: true })
  try {
    const current = JSON.parse(await readFile(DEVICE_TENANT_FILE, 'utf8')) as { accountId?: unknown }
    if (String(current.accountId ?? '').trim() !== accountId) throw new Error('DEVICE_TENANT_MISMATCH')
    return
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }
  await writeFile(DEVICE_TENANT_FILE, JSON.stringify({ accountId }, null, 2), { mode: 0o600 })
}

export function getOrCreateLocalProxySecret(): string {
  try {
    if (existsSync(LOCAL_PROXY_SECRET_FILE)) return readFileSync(LOCAL_PROXY_SECRET_FILE, 'utf8').trim()
  } catch {
    // Generate a fresh secret when the old file cannot be read.
  }
  const secret = randomBytes(32).toString('hex')
  mkdirSync(dirname(LOCAL_PROXY_SECRET_FILE), { recursive: true })
  writeFileSync(LOCAL_PROXY_SECRET_FILE, `${secret}\n`, { mode: 0o600 })
  return secret
}

export async function activateDevice(input: { licenseKey: string; deviceId: string; deviceName?: string }) {
  const response = await fetch(`${gatewayUrl()}/api/jelly/auth/device-activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await response.json() as CloudSessionResponse & { code?: string }
  if (!response.ok) throw new Error(data.code || 'DEVICE_ACTIVATION_FAILED')
  const session = normalizeSession(data, 'device')
  await bindDeviceTenant(session.accountId)
  await writeSession(session, ACTIVATED_DEVICE_SESSION_FILE)
  return session
}

export async function loginWithLicenseKey(licenseKey: string) {
  const response = await fetch(`${gatewayUrl()}/api/jelly/auth/license-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseKey }),
  })
  const data = await response.json() as CloudSessionResponse & { code?: string }
  if (!response.ok) throw new Error(data.code || 'LICENSE_LOGIN_FAILED')
  const session = normalizeSession(data, 'direct')
  await bindDeviceTenant(session.accountId)
  await writeSession(session)
  return session
}

export async function loginWithHostedLicenseKey(licenseKey: string): Promise<HostedSession> {
  const response = await fetch(`${gatewayUrl()}/api/jelly/auth/license-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseKey }),
  })
  const data = await response.json() as CloudSessionResponse & { code?: string }
  if (!response.ok) throw new Error(data.code || 'LICENSE_LOGIN_FAILED')
  const normalized = normalizeSession(data, 'direct')
  const previous = await readHostedSession(normalized.accountId)
  const session: HostedSession = {
    ...normalized,
    localProxySecret: previous?.localProxySecret || randomBytes(32).toString('hex'),
  }
  await writeHostedSession(session)
  return session
}

export async function getCloudAccessToken(): Promise<string> {
  const session = await readSession() || await readSession(ACTIVATED_DEVICE_SESSION_FILE)
  if (!session) throw new Error('DEVICE_ACTIVATION_REQUIRED')
  if (session.expiresAt > Date.now() + 30_000) return session.accessToken

  const response = await fetch(`${gatewayUrl()}/api/jelly/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  })
  const data = await response.json() as CloudSessionResponse & { code?: string }
  if (!response.ok) throw new Error(data.code || 'DEVICE_SESSION_REFRESH_FAILED')
  const refreshed = normalizeSession(data, session.mode)
  await bindDeviceTenant(refreshed.accountId)
  await writeSession(refreshed, session.mode === 'device' ? ACTIVATED_DEVICE_SESSION_FILE : DEVICE_SESSION_FILE)
  return refreshed.accessToken
}

export async function logoutCloudSession(): Promise<void> {
  const session = await readSession()
  if (session) {
    try {
      await fetch(`${gatewayUrl()}/api/jelly/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      })
    } catch {
      // Local logout must still complete while the cloud gateway is offline.
    }
  }
  await unlink(DEVICE_SESSION_FILE).catch(() => undefined)
}

async function getHostedCloudAccessToken(accountId: string): Promise<string> {
  const session = await readHostedSession(accountId)
  if (!session || !session.refreshToken) throw new Error('HOSTED_SESSION_REQUIRED')
  if (session.expiresAt > Date.now() + 30_000) return session.accessToken

  const response = await fetch(`${gatewayUrl()}/api/jelly/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  })
  const data = await response.json() as CloudSessionResponse & { code?: string }
  if (!response.ok) throw new Error(data.code || 'DEVICE_SESSION_REFRESH_FAILED')
  const refreshed: HostedSession = {
    ...normalizeSession(data, session.mode),
    localProxySecret: session.localProxySecret,
  }
  if (refreshed.accountId !== accountId) throw new Error('HOSTED_SESSION_ACCOUNT_MISMATCH')
  await writeHostedSession(refreshed)
  return refreshed.accessToken
}

export async function logoutHostedCloudSession(accountId: string): Promise<void> {
  const session = await readHostedSession(accountId)
  if (session) {
    try {
      await fetch(`${gatewayUrl()}/api/jelly/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      })
    } catch {
      // Browser logout must still complete while the cloud gateway is offline.
    }
  }
  if (session) {
    await writeHostedSession({
      ...session,
      accessToken: '',
      refreshToken: '',
      expiresAt: 0,
    })
  }
}

async function hostedAccountIdForLocalProxySecret(secret: string): Promise<string | null> {
  try {
    const entries = await readdir(HOSTED_SESSION_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const accountId = entry.name.slice(0, -'.json'.length)
      const session = await readHostedSession(accountId)
      if (session && secureEqual(session.localProxySecret, secret)) return accountId
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }
  return null
}

export async function cloudFetch(path: string, init: RequestInit = {}) {
  const accessToken = await getCloudAccessToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)
  return fetch(`${gatewayUrl()}${path}`, { ...init, headers })
}

export async function hostedCloudFetch(accountId: string, path: string, init: RequestInit = {}) {
  const accessToken = await getHostedCloudAccessToken(accountId)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)
  return fetch(`${gatewayUrl()}${path}`, { ...init, headers })
}

export async function cloudFetchForLocalProxySecret(secret: string, path: string, init: RequestInit = {}) {
  const hostedAccountId = await hostedAccountIdForLocalProxySecret(secret)
  if (hostedAccountId) return hostedCloudFetch(hostedAccountId, path, init)
  if (!secureEqual(secret, getOrCreateLocalProxySecret())) throw new Error('UNAUTHORIZED_LOCAL_PROXY')
  return cloudFetch(path, init)
}
