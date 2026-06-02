import type { PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import { config } from './config.js'
import { transaction } from './db.js'

export interface PricingRow {
  model: string
  upstream_model: string
  provider_id: string | null
  input_token_price: string
  output_token_price: string
  credits_multiplier: string
  priority: number
}

export interface Usage {
  promptTokens: number
  completionTokens: number
}

export interface RequestMetadata {
  requestId: string
  skillId?: string
  agentId?: string
}

export async function loadPricingCandidates(client: PoolClient): Promise<PricingRow[]> {
  const result = await client.query<PricingRow>(
    `SELECT model, upstream_model, provider_id, input_token_price, output_token_price, credits_multiplier, priority
     FROM model_pricing
     WHERE enabled = TRUE
     ORDER BY is_default DESC, priority ASC, created_at ASC`,
  )
  if (result.rows.length > 0) return result.rows
  if (!config.defaultModel) throw new Error('MODEL_NOT_CONFIGURED')
  return [{
    model: config.defaultModel,
    upstream_model: config.defaultModel,
    provider_id: null,
    input_token_price: '0',
    output_token_price: '0',
    credits_multiplier: '1',
    priority: 0,
  }]
}

export async function loadDefaultPricing(client: PoolClient): Promise<PricingRow> {
  return (await loadPricingCandidates(client))[0]
}

export function createRequestMetadata(headers: Record<string, string | string[] | undefined>): RequestMetadata {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value
  return {
    requestId: first(headers['x-request-id'])?.trim() || randomUUID(),
    skillId: first(headers['x-jelly-skill-id'])?.trim() || undefined,
    agentId: first(headers['x-jelly-agent-id'])?.trim() || undefined,
  }
}

export function creditsCost(pricing: PricingRow, usage: Usage): number {
  const input = Math.max(0, usage.promptTokens) * Number(pricing.input_token_price)
  const output = Math.max(0, usage.completionTokens) * Number(pricing.output_token_price)
  return Math.max(1, Math.ceil((input + output) * Number(pricing.credits_multiplier)))
}

function estimatedReservation(pricing: PricingRow, payload: unknown): number {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const estimatedPromptTokens = Math.ceil(Buffer.byteLength(JSON.stringify(body), 'utf8') / 2)
  const configuredMax = Number(body.max_completion_tokens ?? body.max_output_tokens ?? body.max_tokens ?? 0)
  const requestedCompletionTokens = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 0
  const estimatedCompletionTokens = Math.max(config.reservationOutputTokens, requestedCompletionTokens)
  return Math.max(config.minimumReservationCredits, creditsCost(pricing, {
    promptTokens: estimatedPromptTokens,
    completionTokens: estimatedCompletionTokens,
  }))
}

export async function reserveCredits(accountId: string, metadata: RequestMetadata, payload: unknown) {
  return transaction(async (client) => {
    const expired = await client.query<{ amount: string }>(
      `UPDATE credit_reservations
       SET status = 'released', updated_at = NOW()
       WHERE account_id = $1 AND status = 'reserved' AND expires_at <= NOW()
       RETURNING amount`,
      [accountId],
    )
    const expiredCredits = expired.rows.reduce((total: number, row: { amount: string }) => total + Number(row.amount), 0)
    if (expiredCredits > 0) {
      await client.query(
        `UPDATE customer_accounts
         SET credits_reserved = GREATEST(credits_reserved - $2, 0), updated_at = NOW()
         WHERE id = $1`,
        [accountId, expiredCredits],
      )
    }
    const accountResult = await client.query<{
      status: string
      credits_balance: string
      credits_reserved: string
      expires_at: string | null
    }>(
      `SELECT status, credits_balance, credits_reserved, expires_at
       FROM customer_accounts WHERE id = $1 FOR UPDATE`,
      [accountId],
    )
    const account = accountResult.rows[0]
    if (!account) throw new Error('ACCOUNT_NOT_FOUND')
    if (account.status !== 'active') throw new Error('ACCOUNT_DISABLED')
    if (account.expires_at && new Date(account.expires_at).getTime() <= Date.now()) throw new Error('LICENSE_EXPIRED')
    const pricingCandidates = await loadPricingCandidates(client)
    if (metadata.skillId) {
      const skill = await client.query<{ enabled: boolean }>(
        'SELECT enabled FROM skill_entitlements WHERE account_id = $1 AND skill_id = $2',
        [accountId, metadata.skillId],
      )
      if (skill.rows[0]?.enabled !== true) throw new Error('SKILL_NOT_ENTITLED')
    }
    const reservationCredits = Math.max(...pricingCandidates.map(pricing => estimatedReservation(pricing, payload)))
    const available = Number(account.credits_balance) - Number(account.credits_reserved)
    if (available < reservationCredits) throw new Error('INSUFFICIENT_CREDITS')

    await client.query(
      'UPDATE customer_accounts SET credits_reserved = credits_reserved + $2, updated_at = NOW() WHERE id = $1',
      [accountId, reservationCredits],
    )
    await client.query(
      `INSERT INTO credit_reservations (account_id, request_id, amount, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '30 minutes')`,
      [accountId, metadata.requestId, reservationCredits],
    )
    return { pricing: pricingCandidates[0], pricingCandidates, reservedCredits: reservationCredits }
  })
}

async function lockedReservation(client: PoolClient, requestId: string) {
  const result = await client.query<{ account_id: string; amount: string; status: string }>(
    `SELECT account_id, amount, status FROM credit_reservations
     WHERE request_id = $1 FOR UPDATE`,
    [requestId],
  )
  const reservation = result.rows[0]
  if (!reservation || reservation.status !== 'reserved') throw new Error('RESERVATION_NOT_FOUND')
  return reservation
}

export async function settleCredits(accountId: string, metadata: RequestMetadata, pricing: PricingRow, usage: Usage) {
  const cost = creditsCost(pricing, usage)
  return transaction(async (client) => {
    const reservation = await lockedReservation(client, metadata.requestId)
    if (reservation.account_id !== accountId) throw new Error('RESERVATION_ACCOUNT_MISMATCH')
    const accountResult = await client.query<{ credits_balance: string }>(
      `UPDATE customer_accounts
       SET credits_balance = credits_balance - $2,
           credits_reserved = GREATEST(credits_reserved - $3, 0),
           updated_at = NOW()
       WHERE id = $1 AND credits_balance >= $2
       RETURNING credits_balance`,
      [accountId, cost, Number(reservation.amount)],
    )
    const account = accountResult.rows[0]
    if (!account) throw new Error('INSUFFICIENT_CREDITS_AFTER_CALL')
    const balance = Number(account.credits_balance)
    await client.query(
      `UPDATE credit_reservations SET status = 'settled', updated_at = NOW() WHERE request_id = $1`,
      [metadata.requestId],
    )
    await client.query(
      `INSERT INTO credit_transactions (account_id, type, amount, balance_after, reason, request_id)
       VALUES ($1, 'model_usage', $2, $3, 'Model usage settlement', $4)`,
      [accountId, -cost, balance, metadata.requestId],
    )
    await client.query(
      `INSERT INTO usage_logs (
         account_id, request_id, model, skill_id, agent_id, prompt_tokens,
         completion_tokens, total_tokens, credits_cost, request_status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'success')`,
      [
        accountId,
        metadata.requestId,
        pricing.model,
        metadata.skillId || null,
        metadata.agentId || null,
        usage.promptTokens,
        usage.completionTokens,
        usage.promptTokens + usage.completionTokens,
        cost,
      ],
    )
    return { cost, balance }
  })
}

export async function releaseCredits(accountId: string, metadata: RequestMetadata, pricing: PricingRow, errorMessage: string) {
  return transaction(async (client) => {
    const reservation = await lockedReservation(client, metadata.requestId)
    if (reservation.account_id !== accountId) throw new Error('RESERVATION_ACCOUNT_MISMATCH')
    await client.query(
      `UPDATE customer_accounts
       SET credits_reserved = GREATEST(credits_reserved - $2, 0), updated_at = NOW()
       WHERE id = $1`,
      [accountId, Number(reservation.amount)],
    )
    await client.query(
      `UPDATE credit_reservations SET status = 'released', updated_at = NOW() WHERE request_id = $1`,
      [metadata.requestId],
    )
    await client.query(
      `INSERT INTO usage_logs (
         account_id, request_id, model, skill_id, agent_id, credits_cost, request_status, error_message
       ) VALUES ($1, $2, $3, $4, $5, 0, 'failed', $6)`,
      [accountId, metadata.requestId, pricing.model, metadata.skillId || null, metadata.agentId || null, errorMessage.slice(0, 1000)],
    )
  })
}
