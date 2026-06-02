const DISABLED_VALUES = new Set(['0', 'false', 'off', 'no'])

export function isJellyManagedMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = String(env.JELLY_MANAGED_MODE ?? '1').trim().toLowerCase()
  return !DISABLED_VALUES.has(value)
}
