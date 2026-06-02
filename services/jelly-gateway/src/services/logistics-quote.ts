import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { config } from '../config.js'

const execFileAsync = promisify(execFile)
const accountQueues = new Map<string, Promise<unknown>>()

function pythonBin(): string {
  if (config.logisticsQuotePythonBin) return config.logisticsQuotePythonBin
  const bundledVenv = join(config.logisticsQuoteSkillDir, '.venv', 'bin', 'python3')
  return existsSync(bundledVenv) ? bundledVenv : 'python3'
}

function sessionFile(accountId: string): string {
  return join(config.logisticsQuoteStateDir, `${accountId}.json`)
}

async function executeQuote(accountId: string, message: string): Promise<string> {
  await mkdir(config.logisticsQuoteStateDir, { recursive: true })
  const script = join(config.logisticsQuoteSkillDir, 'quote_query.py')
  if (!existsSync(script)) throw new Error('LOGISTICS_QUOTE_WORKER_NOT_CONFIGURED')
  try {
    const { stdout } = await execFileAsync(pythonBin(), [script, message], {
      cwd: config.logisticsQuoteSkillDir,
      env: {
        ...process.env,
        LOGISTICS_QUOTE_SESSION_FILE: sessionFile(accountId),
      },
      timeout: config.logisticsQuoteTimeoutSeconds * 1000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    })
    const reply = stdout.trim()
    if (!reply) throw new Error('LOGISTICS_QUOTE_EMPTY_RESPONSE')
    return reply
  } catch (err) {
    const code = err instanceof Error ? err.message : 'LOGISTICS_QUOTE_FAILED'
    if (code.startsWith('LOGISTICS_QUOTE_')) throw err
    throw new Error('LOGISTICS_QUOTE_FAILED')
  }
}

export async function runLogisticsQuote(accountId: string, message: string): Promise<string> {
  const previous = accountQueues.get(accountId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(() => executeQuote(accountId, message))
  accountQueues.set(accountId, next)
  try {
    return await next
  } finally {
    if (accountQueues.get(accountId) === next) accountQueues.delete(accountId)
  }
}
