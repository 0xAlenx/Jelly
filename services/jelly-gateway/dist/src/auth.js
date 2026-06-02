import { config } from './config.js';
import { query } from './db.js';
import { createOpaqueSecret, hashOpaqueSecret, signToken, verifyToken } from './security.js';
function expiresAt(ttlSeconds) {
    return new Date(Date.now() + ttlSeconds * 1000);
}
export async function issueSession(role, subjectId, deviceId) {
    const refreshToken = createOpaqueSecret('jrt');
    await query(`INSERT INTO refresh_tokens (account_id, admin_id, token_hash, expires_at, device_id)
     VALUES ($1, $2, $3, $4, $5)`, [role === 'account' ? subjectId : null, role === 'admin' ? subjectId : null, hashOpaqueSecret(refreshToken), expiresAt(config.refreshTokenTtlSeconds), deviceId || null]);
    return {
        accessToken: signToken({ sub: subjectId, role, kind: 'access', deviceId }, config.accessTokenTtlSeconds),
        refreshToken,
        expiresIn: config.accessTokenTtlSeconds,
    };
}
export async function rotateRefreshToken(rawToken) {
    const tokenHash = hashOpaqueSecret(rawToken);
    const rows = await query(`UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
     RETURNING id, account_id, admin_id, device_id`, [tokenHash]);
    const row = rows[0];
    if (!row)
        throw new Error('INVALID_REFRESH_TOKEN');
    if (row.account_id) {
        await validateAccountAccess(row.account_id, row.device_id || undefined);
        return issueSession('account', row.account_id, row.device_id || undefined);
    }
    if (!row.admin_id)
        throw new Error('INVALID_REFRESH_TOKEN');
    await validateAdminAccess(row.admin_id);
    return issueSession('admin', row.admin_id);
}
export async function revokeRefreshToken(rawToken) {
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL', [hashOpaqueSecret(rawToken)]);
}
function bearer(ctx) {
    const header = String(ctx.headers.authorization ?? '');
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}
export function requireAccess(role) {
    return async (ctx, next) => {
        let verified;
        try {
            verified = verifyToken(bearer(ctx), 'access');
            if (role && verified.role !== role)
                throw new Error('FORBIDDEN');
            if (verified.role === 'account')
                await validateAccountAccess(verified.sub, verified.deviceId);
            else
                await validateAdminAccess(verified.sub);
        }
        catch {
            ctx.status = 401;
            ctx.body = { code: 'UNAUTHORIZED', error: 'Authentication required.' };
            return;
        }
        ctx.state.auth = verified;
        await next();
    };
}
export async function loadActiveAccount(accountId) {
    const rows = await query(`SELECT id, name, company_name, status, credits_balance, credits_reserved, expires_at
     FROM customer_accounts WHERE id = $1`, [accountId]);
    const account = rows[0];
    if (!account)
        throw new Error('ACCOUNT_NOT_FOUND');
    if (account.status !== 'active')
        throw new Error('ACCOUNT_DISABLED');
    if (account.expires_at && new Date(account.expires_at).getTime() <= Date.now())
        throw new Error('LICENSE_EXPIRED');
    return account;
}
async function validateAccountAccess(accountId, deviceId) {
    await loadActiveAccount(accountId);
    if (!deviceId)
        return;
    const rows = await query(`SELECT id FROM activated_devices
     WHERE account_id = $1 AND device_id = $2 AND status = 'active'`, [accountId, deviceId]);
    if (!rows[0])
        throw new Error('DEVICE_DISABLED');
    await query('UPDATE activated_devices SET last_seen_at = NOW() WHERE account_id = $1 AND device_id = $2', [accountId, deviceId]);
}
async function validateAdminAccess(adminId) {
    const rows = await query(`SELECT id FROM admins WHERE id = $1 AND status = 'active'`, [adminId]);
    if (!rows[0])
        throw new Error('ADMIN_DISABLED');
}
export function claims(ctx) {
    return ctx.state.auth;
}
