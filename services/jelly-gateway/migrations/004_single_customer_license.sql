ALTER TABLE license_keys
  ADD COLUMN IF NOT EXISTS key_ciphertext TEXT;

WITH ranked_licenses AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY account_id
           ORDER BY last_used_at DESC NULLS LAST, created_at DESC, id DESC
         ) AS position
  FROM license_keys
)
DELETE FROM license_keys
WHERE id IN (
  SELECT id
  FROM ranked_licenses
  WHERE position > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS license_keys_one_per_account_idx
  ON license_keys(account_id);
