-- Study sessions logged by the user (from Study FC): each one earns club cash and match minutes
CREATE TABLE study_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  activity TEXT NOT NULL DEFAULT 'study' CHECK (activity IN ('study','homework','past_paper','exam_question')),
  minutes INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  marks_awarded INTEGER CHECK (marks_awarded IS NULL OR marks_awarded >= 0),
  marks_total INTEGER CHECK (marks_total IS NULL OR marks_total > 0),
  club_cash REAL NOT NULL DEFAULT 0,
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_study_sessions_user ON study_sessions(user_id, logged_at);
