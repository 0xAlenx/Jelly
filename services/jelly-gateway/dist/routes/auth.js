import Router from '@koa/router';
import { claims, issueSession, loadActiveAccount, requireAccess, revokeRefreshToken, rotateRefreshToken } from '../auth.js';
import { query } from '../db.js';
import { hashOpaqueSecret } from '../security.js';
async function resolveLicense(rawKey) {
    const rows = await query(`SELECT license_keys.id, license_keys.account_id
     FROM license_keys
     JOIN customer_accounts ON customer_accounts.id = license_keys.account_id
     WHERE license_keys.key_hash = $1
       AND license_keys.status = 'active'
       AND (license_keys.expires_at IS NULL OR license_keys.expires_at > NOW())
       AND customer_accounts.status = 'active'
       AND (customer_accounts.expires_at IS NULL OR customer_accounts.expires_at > NOW())`, [hashOpaqueSecret(rawKey)]);
    const license = rows[0];
    if (!license)
        throw new Error('INVALID_LICENSE');
    await query('UPDATE license_keys SET last_used_at = NOW() WHERE id = $1', [license.id]);
    return license;
}
function error(ctx, err) {
    const code = err instanceof Error ? err.message : 'REQUEST_FAILED';
    ctx.status = code === 'INVALID_LICENSE' || code === 'INVALID_REFRESH_TOKEN' ? 401 : 400;
    ctx.body = { code, error: code };
}
export const authRoutes = new Router();
authRoutes.post('/api/jelly/auth/license-login', async (ctx) => {
    try {
        const licenseKey = String(ctx.request.body?.licenseKey ?? '').trim();
        if (!licenseKey)
            throw new Error('LICENSE_KEY_REQUIRED');
        const license = await resolveLicense(licenseKey);
        ctx.body = await issueSession('account', license.account_id);
    }
    catch (err) {
        error(ctx, err);
    }
});
authRoutes.post('/api/jelly/auth/device-activate', async (ctx) => {
    try {
        const body = ctx.request.body ?? {};
        const licenseKey = String(body.licenseKey ?? '').trim();
        const deviceId = String(body.deviceId ?? '').trim();
        const deviceName = String(body.deviceName ?? '').trim();
        if (!licenseKey)
            throw new Error('LICENSE_KEY_REQUIRED');
        if (!deviceId)
            throw new Error('DEVICE_ID_REQUIRED');
        const license = await resolveLicense(licenseKey);
        await query(`INSERT INTO activated_devices (account_id, device_id, device_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, device_id)
       DO UPDATE SET device_name = EXCLUDED.device_name, status = 'active', last_seen_at = NOW()`, [license.account_id, deviceId, deviceName || null]);
        ctx.body = await issueSession('account', license.account_id, deviceId);
    }
    catch (err) {
        error(ctx, err);
    }
});
authRoutes.post('/api/jelly/auth/refresh', async (ctx) => {
    try {
        const refreshToken = String(ctx.request.body?.refreshToken ?? '').trim();
        if (!refreshToken)
            throw new Error('REFRESH_TOKEN_REQUIRED');
        ctx.body = await rotateRefreshToken(refreshToken);
    }
    catch (err) {
        error(ctx, err);
    }
});
authRoutes.post('/api/jelly/auth/logout', async (ctx) => {
    const refreshToken = String(ctx.request.body?.refreshToken ?? '').trim();
    if (refreshToken)
        await revokeRefreshToken(refreshToken);
    ctx.body = { success: true };
});
authRoutes.get('/api/jelly/me', requireAccess('account'), async (ctx) => {
    try {
        const account = await loadActiveAccount(claims(ctx).sub);
        const skills = await query('SELECT skill_id FROM skill_entitlements WHERE account_id = $1 AND enabled = TRUE ORDER BY skill_id', [account.id]);
        const usage = await query(`SELECT COALESCE(SUM(credits_cost), 0)::text AS credits_today
       FROM usage_logs WHERE account_id = $1 AND created_at >= CURRENT_DATE`, [account.id]);
        ctx.body = {
            id: account.id,
            name: account.name,
            companyName: account.company_name,
            status: account.status,
            creditsBalance: Number(account.credits_balance),
            creditsReserved: Number(account.credits_reserved),
            creditsToday: Number(usage[0]?.credits_today ?? 0),
            expiresAt: account.expires_at,
            skills: skills.map(row => row.skill_id),
        };
    }
    catch (err) {
        error(ctx, err);
    }
});
