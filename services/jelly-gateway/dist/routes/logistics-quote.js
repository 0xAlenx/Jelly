import Router from '@koa/router';
import { randomUUID } from 'node:crypto';
import { claims, requireAccess } from '../auth.js';
import { query } from '../db.js';
import { runLogisticsQuote } from '../services/logistics-quote.js';
const skillId = 'logistics-assistant';
function error(ctx, err) {
    const code = err instanceof Error ? err.message : 'LOGISTICS_QUOTE_FAILED';
    ctx.status = code === 'SKILL_NOT_ENTITLED' ? 403 : 400;
    ctx.body = { code, error: code };
}
async function log(accountId, requestId, status, errorMessage) {
    await query(`INSERT INTO usage_logs (
       account_id, request_id, model, skill_id, credits_cost, request_status, error_message
     ) VALUES ($1, $2, 'skill:logistics-quote', $3, 0, $4, $5)`, [accountId, requestId, skillId, status, errorMessage?.slice(0, 1000) || null]);
}
export const logisticsQuoteRoutes = new Router();
logisticsQuoteRoutes.post('/api/jelly/web/skills/logistics-quote/run', requireAccess('account'), async (ctx) => {
    const accountId = claims(ctx).sub;
    const requestId = randomUUID();
    try {
        const entitlements = await query('SELECT enabled FROM skill_entitlements WHERE account_id = $1 AND skill_id = $2', [accountId, skillId]);
        if (entitlements[0]?.enabled !== true)
            throw new Error('SKILL_NOT_ENTITLED');
        const message = String(ctx.request.body?.message ?? '').trim();
        if (!message)
            throw new Error('LOGISTICS_QUOTE_MESSAGE_REQUIRED');
        if (message.length > 20_000)
            throw new Error('LOGISTICS_QUOTE_MESSAGE_TOO_LONG');
        const reply = await runLogisticsQuote(accountId, message);
        await log(accountId, requestId, 'success');
        ctx.body = { requestId, skillId, reply, creditsCost: 0 };
    }
    catch (err) {
        try {
            await log(accountId, requestId, 'failed', err instanceof Error ? err.message : 'LOGISTICS_QUOTE_FAILED');
        }
        catch {
            // Keep the original worker error when logging is unavailable.
        }
        error(ctx, err);
    }
});
