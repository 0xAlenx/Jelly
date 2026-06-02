const DISABLED_VALUES = new Set(['0', 'false', 'off', 'no'])

export function isJellyManagedMode(): boolean {
  const value = String(import.meta.env.VITE_JELLY_MANAGED_MODE ?? '1').trim().toLowerCase()
  return !DISABLED_VALUES.has(value)
}
