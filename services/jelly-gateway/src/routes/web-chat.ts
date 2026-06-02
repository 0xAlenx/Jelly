import Router from '@koa/router'
import { claims, requireAccess } from '../auth.js'
import { query, transaction } from '../db.js'

interface SessionRow {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

function text(value: unknown, fallback = ''): string {
  return String(value ?? fallback).trim()
}

function error(ctx: any, err: unknown) {
  const code = err instanceof Error ? err.message : 'REQUEST_FAILED'
  ctx.status = code === 'WEB_CHAT_SESSION_NOT_FOUND' ? 404 : 400
  ctx.body = { code, error: code }
}

export const webChatRoutes = new Router()

webChatRoutes.use('/api/jelly/web', requireAccess('account'))

webChatRoutes.get('/api/jelly/web/sessions', async (ctx) => {
  const sessions = await query<SessionRow>(
    `SELECT id, title, created_at, updated_at
     FROM web_chat_sessions
     WHERE account_id = $1
     ORDER BY updated_at DESC
     LIMIT 100`,
    [claims(ctx).sub],
  )
  ctx.body = sessions
})

webChatRoutes.post('/api/jelly/web/sessions', async (ctx) => {
  try {
    const title = text((ctx.request as any).body?.title, '新对话').slice(0, 80) || '新对话'
    const sessions = await query<SessionRow>(
      `INSERT INTO web_chat_sessions (account_id, title)
       VALUES ($1, $2)
       RETURNING id, title, created_at, updated_at`,
      [claims(ctx).sub, title],
    )
    ctx.status = 201
    ctx.body = sessions[0]
  } catch (err) {
    error(ctx, err)
  }
})

webChatRoutes.get('/api/jelly/web/sessions/:sessionId/messages', async (ctx) => {
  try {
    const accountId = claims(ctx).sub
    const session = await query<{ id: string }>(
      'SELECT id FROM web_chat_sessions WHERE id = $1 AND account_id = $2',
      [ctx.params.sessionId, accountId],
    )
    if (!session[0]) throw new Error('WEB_CHAT_SESSION_NOT_FOUND')
    ctx.body = await query<MessageRow>(
      `SELECT id, role, content, created_at
       FROM web_chat_messages
       WHERE session_id = $1 AND account_id = $2
       ORDER BY created_at ASC, id ASC`,
      [ctx.params.sessionId, accountId],
    )
  } catch (err) {
    error(ctx, err)
  }
})

webChatRoutes.post('/api/jelly/web/sessions/:sessionId/messages', async (ctx) => {
  try {
    const accountId = claims(ctx).sub
    const role = text((ctx.request as any).body?.role)
    const content = text((ctx.request as any).body?.content)
    if (role !== 'user' && role !== 'assistant') throw new Error('WEB_CHAT_MESSAGE_ROLE_INVALID')
    if (!content) throw new Error('WEB_CHAT_MESSAGE_REQUIRED')
    if (content.length > 200_000) throw new Error('WEB_CHAT_MESSAGE_TOO_LONG')
    ctx.body = await transaction(async (client) => {
      const sessions = await client.query<{ id: string }>(
        'SELECT id FROM web_chat_sessions WHERE id = $1 AND account_id = $2 FOR UPDATE',
        [ctx.params.sessionId, accountId],
      )
      if (!sessions.rows[0]) throw new Error('WEB_CHAT_SESSION_NOT_FOUND')
      const inserted = await client.query<MessageRow>(
        `INSERT INTO web_chat_messages (session_id, account_id, role, content)
         VALUES ($1, $2, $3, $4)
         RETURNING id, role, content, created_at`,
        [ctx.params.sessionId, accountId, role, content],
      )
      await client.query(
        'UPDATE web_chat_sessions SET updated_at = NOW() WHERE id = $1 AND account_id = $2',
        [ctx.params.sessionId, accountId],
      )
      return inserted.rows[0]
    })
  } catch (err) {
    error(ctx, err)
  }
})

webChatRoutes.delete('/api/jelly/web/sessions/:sessionId', async (ctx) => {
  try {
    const deleted = await query<{ id: string }>(
      `DELETE FROM web_chat_sessions
       WHERE id = $1 AND account_id = $2
       RETURNING id`,
      [ctx.params.sessionId, claims(ctx).sub],
    )
    if (!deleted[0]) throw new Error('WEB_CHAT_SESSION_NOT_FOUND')
    ctx.body = { success: true }
  } catch (err) {
    error(ctx, err)
  }
})
