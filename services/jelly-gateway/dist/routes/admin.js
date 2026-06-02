import Router from '@koa/router';
import { claims, issueSession, requireAccess } from '../auth.js';
import { query, transaction } from '../db.js';
import { createOpaqueSecret, decryptSecret, encryptSecret, hashOpaqueSecret, verifyPassword } from '../security.js';
function body(ctx) {
    return ctx.request?.body ?? {};
}
function error(ctx, err) {
    const code = err instanceof Error ? err.message : 'REQUEST_FAILED';
    ctx.status = code === 'ADMIN_LOGIN_FAILED' ? 401 : 400;
    ctx.body = { code, error: code };
}
function nonNegativeInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}
export const adminRoutes = new Router();
adminRoutes.post('/api/jelly/admin/auth/login', async (ctx) => {
    try {
        const input = body(ctx);
        const rows = await query(`SELECT id, password_hash FROM admins
       WHERE username = $1 AND status = 'active'`, [String(input.username ?? '').trim()]);
        const admin = rows[0];
        if (!admin || !verifyPassword(String(input.password ?? ''), admin.password_hash)) {
            throw new Error('ADMIN_LOGIN_FAILED');
        }
        ctx.body = await issueSession('admin', admin.id);
    }
    catch (err) {
        error(ctx, err);
    }
});
adminRoutes.use('/api/jelly/admin', requireAccess('admin'));
adminRoutes.get('/api/jelly/admin/summary', async (ctx) => {
    const [accounts, usage, modelGateway] = await Promise.all([
        query(`SELECT COUNT(*) FILTER (WHERE status = 'active')::text AS active_accounts,
              COALESCE(SUM(credits_balance), 0)::text AS credits_balance
       FROM customer_accounts`),
        query(`SELECT COUNT(*)::text AS calls_today, COALESCE(SUM(credits_cost), 0)::text AS credits_today
       FROM usage_logs WHERE created_at >= CURRENT_DATE`),
        query(`SELECT EXISTS (
         SELECT 1
         FROM model_pricing
         JOIN model_providers ON model_providers.id = model_pricing.provider_id
         WHERE model_pricing.enabled = TRUE AND model_providers.enabled = TRUE
       ) AS configured`),
    ]);
    ctx.body = {
        activeAccounts: Number(accounts[0]?.active_accounts ?? 0),
        creditsBalance: Number(accounts[0]?.credits_balance ?? 0),
        callsToday: Number(usage[0]?.calls_today ?? 0),
        creditsToday: Number(usage[0]?.credits_today ?? 0),
        modelGatewayConfigured: modelGateway[0]?.configured === true,
    };
});
adminRoutes.get('/api/jelly/admin/accounts', async (ctx) => {
    ctx.body = await query(`SELECT id, name, company_name, status, credits_balance, credits_reserved, expires_at, created_at, updated_at
     FROM customer_accounts ORDER BY created_at DESC`);
});
adminRoutes.post('/api/jelly/admin/accounts', async (ctx) => {
    try {
        const input = body(ctx);
        const name = String(input.name ?? '').trim();
        const companyName = String(input.companyName ?? '').trim();
        if (!name || !companyName)
            throw new Error('NAME_AND_COMPANY_REQUIRED');
        const creditsBalance = Math.max(0, Math.floor(Number(input.creditsBalance ?? 0)));
        const rawKey = createOpaqueSecret('jlk');
        const account = await transaction(async (client) => {
            const rows = await client.query(`INSERT INTO customer_accounts (name, company_name, credits_balance, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, company_name, status, credits_balance, credits_reserved, expires_at, created_at`, [name, companyName, creditsBalance, input.expiresAt || null]);
            const created = rows.rows[0];
            if (creditsBalance > 0) {
                await client.query(`INSERT INTO credit_transactions (account_id, type, amount, balance_after, reason)
           VALUES ($1, 'initial_grant', $2, $2, 'Initial account credits')`, [created.id, creditsBalance]);
            }
            await client.query(`INSERT INTO license_keys (account_id, key_prefix, key_hash, key_ciphertext, expires_at)
         VALUES ($1, $2, $3, $4, $5)`, [created.id, rawKey.slice(0, 12), hashOpaqueSecret(rawKey), encryptSecret(rawKey), input.expiresAt || null]);
            await client.query(`INSERT INTO skill_entitlements (account_id, skill_id, enabled)
         VALUES ($1, 'logistics-assistant', TRUE)
         ON CONFLICT (account_id, skill_id) DO UPDATE SET enabled = TRUE, updated_at = NOW()`, [created.id]);
            return { ...created, licenseKey: rawKey };
        });
        ctx.status = 201;
        ctx.body = account;
    }
    catch (err) {
        error(ctx, err);
    }
});
adminRoutes.patch('/api/jelly/admin/accounts/:accountId', async (ctx) => {
    try {
        const input = body(ctx);
        const rows = await query(`UPDATE customer_accounts
       SET name = COALESCE($2, name),
           company_name = COALESCE($3, company_name),
           status = COALESCE($4, status),
           expires_at = CASE WHEN $5::boolean THEN $6::timestamptz ELSE expires_at END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, company_name, status, credits_balance, credits_reserved, expires_at, updated_at`, [
            ctx.params.accountId,
            input.name || null,
            input.companyName || null,
            input.status || null,
            Object.prototype.hasOwnProperty.call(input, 'expiresAt'),
            input.expiresAt || null,
        ]);
        if (!rows[0])
            throw new Error('ACCOUNT_NOT_FOUND');
        ctx.body = rows[0];
    }
    catch (err) {
        error(ctx, err);
    }
});
adminRoutes.delete('/api/jelly/admin/accounts/:accountId', async (ctx) => {
    try {
        const rows = await query(`DELETE FROM customer_accounts
       WHERE id = $1
       RETURNING id`, [ctx.params.accountId]);
        if (!rows[0])
            throw new Error('ACCOUNT_NOT_FOUND');
        ctx.body = { success: true, accountId: rows[0].id };
    }
    catch (err) {
        error(ctx, err);
    }
});
adminRoutes.post('/api/jelly/admin/accounts/:accountId/licenses', async (ctx) => {
    try {
        const input = body(ctx);
        ctx.body = await transaction(async (client) => {
            const account = await client.query('SELECT id FROM customer_accounts WHERE id = $1 FOR UPDATE', [ctx.params.accountId]);
            if (!account.rows[0])
                throw new Error('ACCOUNT_NOT_FOUND');
            const existing = await client.query(`SELECT id, account_id, key_prefix, key_ciphertext, status, expires_at, created_at
         FROM license_keys
         WHERE account_id = $1
         LIMIT 1`, [ctx.params.accountId]);
            const license = existing.rows[0];
            if (license?.key_ciphertext) {
                const { key_ciphertext: ciphertext, ...publicLicense } = license;
                return { ...publicLicense, licenseKey: decryptSecret(ciphertext) };
            }
            const rawKey = createOpaqueSecret('jlk');
            if (license) {
                const rows = await client.query(`UPDATE license_keys
           SET key_prefix = $2,
               key_hash = $3,
               key_ciphertext = $4,
               status = 'active',
               expires_at = COALESCE($5, expires_at),
               last_used_at = NULL
           WHERE id = $1
           RETURNING id, account_id, key_prefix, status, expires_at, created_at`, [license.id, rawKey.slice(0, 12), hashOpaqueSecret(rawKey), encryptSecret(rawKey), input.expiresAt || null]);
                return { ...rows.rows[0], licenseKey: rawKey };
            }
            const rows = await client.query(`INSERT INTO license_keys (account_id, key_prefix, key_hash, key_ciphertext, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, account_id, key_prefix, status, expires_at, created_at`, [ctx.params.accountId, rawKey.slice(0, 12), hashOpaqueSecret(rawKey), encryptSecret(rawKey), input.expiresAt || null]);
            return { ...rows.rows[0], licenseKey: rawKey };
        });
    }
    catch (err) {
        error(ctx, err);
    }
});
adminRoutes.get('/api/jelly/admin/accounts/:accountId/licenses', async (ctx) => {
    ctx.body = await query(`SELECT id, key_prefix, status, expires_at, created_at, last_used_at
     FROM license_keys WHERE account_id = $1 ORDER BY created_at DESC`, [ctx.params.accountId]);
});
adminRoutes.patch('/api/jelly/admin/accounts/:accountId/licenses/:licenseId', async (ctx) => {
    try {
        const input = body(ctx);
        const status = input.status === undefined ? null : String(input.status);
        if (status !== null && status !== 'active' && status !== 'disabled')
            throw new Error('INVALID_LICENSE_STATUS');
        const rows = await query(`UPDATE license_keys
       SET status = COALESCE($3, status),
           expires_at = CASE WHEN $4::boolean THEN $5::timestamptz ELSE expires_at END
       WHERE id = $1 AND account_id = $2
       RETURNING id, key_prefix, status, expires_at, created_at, last_used_at`, [
            ctx.params.licenseId,
            ctx.params.accountId,
            status,
            Object.prototype.hasOwnProperty.call(input, 'expiresAt'),
            input.expiresAt || null,
        ]);
        if (!rows[0])
            throw new Error('LICENSE_NOT_FOUND');
        ctx.body = rows[0];
    }
    catch (err) {
        error(ctx, err);
    }
});
adminRoutes.post('/api/jelly/admin/accounts/:accountId/credits', async (ctx) => {
    try {
        const input = body(ctx);
        const amount = Number(input.amount);
        const reason = String(input.reason ?? '').trim();
        if (!Number.isInteger(amount) || amount === 0 || !reason)
            throw new Error('INVALID_CREDIT_ADJUSTMENT');
        ctx.body = await transaction(async (client) => {
            const result = await client.query(`UPDATE customer_accounts
         SET credits_balance = credits_balance + $2, updated_at = NOW()
         WHERE id = $1 AND credits_balance + $2 >= 0
         RETURNING credits_balance`, [ctx.params.accountId, amount]);
            const account = result.rows[0];
            if (!account)
                throw new Error('INVALID_CREDIT_ADJUSTMENT');
            const rows = await client.query(`INSERT INTO credit_transactions (account_id, type, amount, balance_after, reason)
         VALUES ($1, 'admin_adjustment', $2, $3, $4)
         RETURNING id, account_id, type, amount, balance_after, reason, created_at`, [ctx.params.accountId, amount, account.credits_balance, reason]);
            return rows.rows[0];
        });
    }
    catch (err) {
        error(ctx, err);
    }
});
adminRoutes.get('/api/jelly/admin/accounts/:accountId/transactions', async (ctx) => {
    ctx.body = await query(`SELECT id, type, amount, balance_after, reason, request_id, created_at
     FROM credit_transactions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 200`, [ctx.params.accountId]);
});
adminRoutes.get('/api/jelly/admin/accounts/:accountId/usage', async (ctx) => {
    ctx.body = await query(`SELECT request_id, model, skill_id, agent_id, prompt_tokens, completion_tokens,
            total_tokens, credits_cost, request_status, error_message, created_at
     FROM usage_logs WHERE account_id = $1 ORDER BY created_at DESC LIMIT 200`, [ctx.params.accountId]);
});
adminRoutes.get('/api/jelly/admin/accounts/:accountId/skills', async (ctx) => {
    ctx.body = await query(`SELECT skill_id, enabled, updated_at
     FROM skill_entitlements WHERE account_id = $1 ORDER BY skill_id ASC`, [ctx.params.accountId]);
});
adminRoutes.get('/api/jelly/admin/models', async (ctx) => {
    ctx.body = await query(`SELECT model_pricing.id, model_pricing.model, model_pricing.upstream_model,
            model_pricing.provider_id, model_providers.name AS provider_name,
            model_pricing.input_token_price, model_pricing.output_token_price,
            model_pricing.credits_multiplier, model_pricing.enabled, model_pricing.is_default, model_pricing.priority,
            model_pricing.created_at, model_pricing.updated_at
     FROM model_pricing
     LEFT JOIN model_providers ON model_providers.id = model_pricing.provider_id
     ORDER BY model_pricing.is_default DESC, model_pricing.priority ASC, model_pricing.created_at ASC`);
});
adminRoutes.get('/api/jelly/admin/providers', async (ctx) => {
    ctx.body = await query(`SELECT id, name, base_url, enabled, is_default,
            (api_key_ciphertext <> '') AS api_key_configured, created_at, updated_at
     FROM model_providers ORDER BY is_default DESC, created_at ASC`);
});
adminRoutes.put('/api/jelly/admin/providers/:name', async (ctx) => {
    try {
        const input = body(ctx);
        const name = String(ctx.params.name ?? '').trim();
        const baseUrl = String(input.baseUrl ?? '').trim().replace(/\/+$/, '');
        const apiKey = String(input.apiKey ?? '').trim();
        if (!name || !baseUrl)
            throw new Error('PROVIDER_NAME_AND_BASE_URL_REQUIRED');
        ctx.body = await transaction(async (client) => {
            const existing = await client.query('SELECT api_key_ciphertext FROM model_providers WHERE name = $1', [name]);
            const apiKeyCiphertext = apiKey ? encryptSecret(apiKey) : existing.rows[0]?.api_key_ciphertext;
            if (!apiKeyCiphertext)
                throw new Error('PROVIDER_API_KEY_REQUIRED');
            if (input.isDefault === true) {
                await client.query('UPDATE model_providers SET is_default = FALSE, updated_at = NOW() WHERE is_default = TRUE');
            }
            const result = await client.query(`INSERT INTO model_providers (name, base_url, api_key_ciphertext, enabled, is_default)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (name) DO UPDATE SET
           base_url = EXCLUDED.base_url,
           api_key_ciphertext = EXCLUDED.api_key_ciphertext,
           enabled = EXCLUDED.enabled,
           is_default = EXCLUDED.is_default,
           updated_at = NOW()
         RETURNING id, name, base_url, enabled, is_default,
                   (api_key_ciphertext <> '') AS api_key_configured, created_at, updated_at`, [name, baseUrl, apiKeyCiphertext, input.enabled !== false, input.isDefault === true]);
            return result.rows[0];
        });
    }
    catch (err) {
        error(ctx, err);
    }
});
adminRoutes.put('/api/jelly/admin/models/:model', async (ctx) => {
    try {
        const input = body(ctx);
        const model = String(ctx.params.model ?? '').trim();
        const upstreamModel = String(input.upstreamModel ?? '').trim();
        const providerId = String(input.providerId ?? '').trim();
        const priority = nonNegativeInteger(input.priority, input.isDefault === true ? 0 : 100);
        if (!model || !upstreamModel || !providerId)
            throw new Error('MODEL_UPSTREAM_AND_PROVIDER_REQUIRED');
        ctx.body = await transaction(async (client) => {
            if (input.isDefault === true) {
                await client.query('UPDATE model_pricing SET is_default = FALSE, updated_at = NOW() WHERE is_default = TRUE');
            }
            const result = await client.query(`INSERT INTO model_pricing (
           model, upstream_model, provider_id, input_token_price, output_token_price, credits_multiplier, enabled, is_default, priority
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (model) DO UPDATE SET
           upstream_model = EXCLUDED.upstream_model,
           provider_id = EXCLUDED.provider_id,
           input_token_price = EXCLUDED.input_token_price,
           output_token_price = EXCLUDED.output_token_price,
           credits_multiplier = EXCLUDED.credits_multiplier,
           enabled = EXCLUDED.enabled,
           is_default = EXCLUDED.is_default,
           priority = EXCLUDED.priority,
           updated_at = NOW()
         RETURNING id, model, upstream_model, input_token_price, output_token_price,
                   provider_id, credits_multiplier, enabled, is_default, priority, created_at, updated_at`, [
                model,
                upstreamModel,
                providerId,
                Math.max(0, Number(input.inputTokenPrice ?? 0)),
                Math.max(0, Number(input.outputTokenPrice ?? 0)),
                Math.max(0, Number(input.creditsMultiplier ?? 1)),
                input.enabled !== false,
                input.isDefault === true,
                priority,
            ]);
            return result.rows[0];
        });
    }
    catch (err) {
        error(ctx, err);
    }
});
adminRoutes.put('/api/jelly/admin/accounts/:accountId/skills/:skillId', async (ctx) => {
    const enabled = body(ctx).enabled !== false;
    ctx.body = (await query(`INSERT INTO skill_entitlements (account_id, skill_id, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (account_id, skill_id)
     DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
     RETURNING account_id, skill_id, enabled, updated_at`, [ctx.params.accountId, ctx.params.skillId, enabled]))[0];
});
adminRoutes.get('/api/jelly/admin/session', async (ctx) => {
    ctx.body = { adminId: claims(ctx).sub };
});
