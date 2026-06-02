CREATE TABLE IF NOT EXISTS web_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '新对话',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS web_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES web_chat_sessions(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS web_chat_sessions_account_updated_idx
  ON web_chat_sessions(account_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS web_chat_messages_session_created_idx
  ON web_chat_messages(account_id, session_id, created_at ASC);
