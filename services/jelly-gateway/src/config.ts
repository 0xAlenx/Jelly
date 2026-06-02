import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

function loadLocalEnvironment() {
  const path = String(process.env.JELLY_ENV_FILE ?? resolve(homedir(), '.jellyai', 'gateway.env')).trim()
  if (!path || !existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || process.env[match[1]] !== undefined) continue
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

loadLocalEnvironment()

function required(name: string): string {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function integer(name: string, fallback: number): number {
  const value = Number.parseInt(String(process.env[name] ?? ''), 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const config = {
  port: integer('PORT', 8787),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JELLY_JWT_SECRET'),
  accessKeyPepper: required('JELLY_ACCESS_KEY_PEPPER'),
  configEncryptionKey: String(process.env.JELLY_CONFIG_ENCRYPTION_KEY ?? process.env.JELLY_JWT_SECRET ?? '').trim(),
  adminUsername: String(process.env.JELLY_ADMIN_USERNAME ?? '').trim(),
  adminPassword: String(process.env.JELLY_ADMIN_PASSWORD ?? '').trim(),
  modelBaseUrl: String(process.env.JELLY_MODEL_BASE_URL ?? '').trim().replace(/\/+$/, ''),
  modelApiKey: String(process.env.JELLY_MODEL_API_KEY ?? '').trim(),
  defaultModel: String(process.env.JELLY_DEFAULT_MODEL ?? '').trim(),
  accessTokenTtlSeconds: integer('JELLY_ACCESS_TOKEN_TTL_SECONDS', 15 * 60),
  refreshTokenTtlSeconds: integer('JELLY_REFRESH_TOKEN_TTL_SECONDS', 30 * 24 * 60 * 60),
  minimumReservationCredits: integer('JELLY_MINIMUM_RESERVATION_CREDITS', 5),
  reservationOutputTokens: integer('JELLY_RESERVATION_OUTPUT_TOKENS', 2048),
  logisticsQuotePythonBin: String(process.env.JELLY_LOGISTICS_QUOTE_PYTHON_BIN ?? '').trim(),
  logisticsQuoteSkillDir: String(process.env.JELLY_LOGISTICS_QUOTE_SKILL_DIR ?? resolve(process.cwd(), 'skills', 'logistics-quote')).trim(),
  logisticsQuoteStateDir: String(process.env.JELLY_LOGISTICS_QUOTE_STATE_DIR ?? resolve(process.cwd(), 'data', 'logistics-quote')).trim(),
  logisticsQuoteTimeoutSeconds: integer('JELLY_LOGISTICS_QUOTE_TIMEOUT_SECONDS', 45),
  corsOrigins: String(process.env.JELLY_CORS_ORIGINS ?? 'https://app.jellyai.cloud')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
}
