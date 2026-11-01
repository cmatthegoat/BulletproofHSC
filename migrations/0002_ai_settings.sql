-- Each user's own OpenRouter key (encrypted) and chosen model
CREATE TABLE user_ai_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_key_encrypted TEXT NOT NULL,
  key_hint TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
