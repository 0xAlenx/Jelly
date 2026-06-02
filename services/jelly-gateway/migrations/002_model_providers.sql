CREATE TABLE IF NOT EXISTS model_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE model_pricing
  ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES model_providers(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS model_providers_default_idx
  ON model_providers(is_default DESC, created_at ASC)
  WHERE enabled = TRUE;
