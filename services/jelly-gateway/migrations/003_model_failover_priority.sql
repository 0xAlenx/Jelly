ALTER TABLE model_pricing
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100;

UPDATE model_pricing
SET priority = 0
WHERE is_default = TRUE AND priority = 100;

CREATE INDEX IF NOT EXISTS model_pricing_failover_idx
  ON model_pricing(is_default DESC, priority ASC, created_at ASC)
  WHERE enabled = TRUE;
