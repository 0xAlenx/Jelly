const ENABLED_VALUES = new Set(['1', 'true', 'on', 'yes'])

export const JELLY_WEB_HOSTED_USER_PREFIX = 'jellyai-web-'

export function isJellyWebHostedMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return ENABLED_VALUES.has(String(env.JELLY_WEB_HOSTED_MODE ?? '').trim().toLowerCase())
}

export function hostedUsername(accountId: string): string {
  return `${JELLY_WEB_HOSTED_USER_PREFIX}${accountId}`
}

export function hostedAccountIdFromUsername(username: string): string | null {
  const value = String(username || '').trim()
  if (!value.startsWith(JELLY_WEB_HOSTED_USER_PREFIX)) return null
  return value.slice(JELLY_WEB_HOSTED_USER_PREFIX.length).trim() || null
}

export function hostedProfileName(accountId: string): string {
  const segment = String(accountId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)
  if (!segment) throw new Error('INVALID_JELLY_ACCOUNT_ID')
  return `jelly-web-${segment}`
}
