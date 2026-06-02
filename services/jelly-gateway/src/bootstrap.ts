import { config } from './config.js'
import { query } from './db.js'
import { encryptSecret, hashPassword } from './security.js'

export async function bootstrapAdmin() {
  const rows = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM admins')
  if (Number(rows[0]?.count ?? 0) > 0) return
  if (!config.adminUsername || !config.adminPassword) {
    throw new Error('Set JELLY_ADMIN_USERNAME and JELLY_ADMIN_PASSWORD to create the first administrator.')
  }
  await query(
    'INSERT INTO admins (username, password_hash) VALUES ($1, $2)',
    [config.adminUsername, hashPassword(config.adminPassword)],
  )
  console.log('[jelly-gateway] initial administrator created')
}

export async function bootstrapEnvironmentModelProvider() {
  if (!config.modelBaseUrl || !config.modelApiKey) return
  const providers = await query<{ id: string }>('SELECT id FROM model_providers LIMIT 1')
  if (providers[0]) return
  const rows = await query<{ id: string }>(
    `INSERT INTO model_providers (name, base_url, api_key_ciphertext, is_default)
     VALUES ('环境变量默认供应商', $1, $2, TRUE)
     RETURNING id`,
    [config.modelBaseUrl, encryptSecret(config.modelApiKey)],
  )
  if (rows[0]) {
    await query('UPDATE model_pricing SET provider_id = $1 WHERE provider_id IS NULL', [rows[0].id])
  }
  console.log('[jelly-gateway] environment model provider migrated to encrypted database configuration')
}
