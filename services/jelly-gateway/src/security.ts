import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

type TokenKind = 'access' | 'refresh'
export type AuthRole = 'account' | 'admin'

export interface TokenClaims {
  sub: string
  role: AuthRole
  kind: TokenKind
  exp: number
  iat: number
  deviceId?: string
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function signature(value: string): string {
  return createHmac('sha256', config.jwtSecret).update(value).digest('base64url')
}

export function hashOpaqueSecret(value: string): string {
  return createHmac('sha256', config.accessKeyPepper).update(value).digest('hex')
}

export function createOpaqueSecret(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`
}

function encryptionKey(): Buffer {
  return createHash('sha256').update(config.configEncryptionKey).digest()
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptSecret(value: string): string {
  const [version, iv, tag, encrypted] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('INVALID_ENCRYPTED_SECRET')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${derived}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(':')
  if (!salt || !expected) return false
  const actual = scryptSync(password, salt, 64)
  const expectedBuffer = Buffer.from(expected, 'hex')
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer)
}

export function signToken(input: Omit<TokenClaims, 'iat' | 'exp'>, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000)
  const claims: TokenClaims = { ...input, iat: now, exp: now + ttlSeconds }
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify(claims))
  const unsigned = `${header}.${payload}`
  return `${unsigned}.${signature(unsigned)}`
}

export function verifyToken(token: string, kind: TokenKind): TokenClaims {
  const [header, payload, provided] = token.split('.')
  if (!header || !payload || !provided) throw new Error('INVALID_TOKEN')
  const unsigned = `${header}.${payload}`
  const expected = signature(unsigned)
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    throw new Error('INVALID_TOKEN')
  }
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenClaims
  if (claims.kind !== kind || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error('INVALID_TOKEN')
  return claims
}
