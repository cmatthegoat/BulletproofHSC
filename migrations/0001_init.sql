-- Core account tables
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Fixed-window counters keyed by "<action>:<ip>:<window>"
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, usage_date)
);
CREATE INDEX idx_ai_usage_user ON ai_usage(user_id);

-- Study data
CREATE TABLE subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#4f46e5',
  course_type TEXT NOT NULL DEFAULT 'HSC' CHECK (course_type IN ('Preliminary', 'HSC')),
  notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_subjects_user ON subjects(user_id);

CREATE TABLE syllabus_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  code TEXT NOT NULL DEFAULT '',
  module TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  target_percentage INTEGER CHECK (target_percentage IS NULL OR (target_percentage BETWEEN 0 AND 100)),
  improvement_goal TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_syllabus_user ON syllabus_points(user_id);
CREATE INDEX idx_syllabus_subject ON syllabus_points(subject_id);

CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  syllabus_point_id INTEGER REFERENCES syllabus_points(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT '',
  question_text TEXT NOT NULL,
  total_marks INTEGER NOT NULL CHECK (total_marks > 0),
  marking_criteria TEXT NOT NULL DEFAULT '',
  student_answer TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_questions_user ON questions(user_id);
CREATE INDEX idx_questions_subject ON questions(subject_id);
CREATE INDEX idx_questions_syllabus ON questions(syllabus_point_id);

-- One row per AI marking run (or manual score), used for stats and trends
CREATE TABLE attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  syllabus_point_id INTEGER REFERENCES syllabus_points(id) ON DELETE SET NULL,
  marks_awarded INTEGER NOT NULL,
  marks_total INTEGER NOT NULL,
  percentage REAL NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attempts_user ON attempts(user_id);
CREATE INDEX idx_attempts_subject ON attempts(subject_id);
CREATE INDEX idx_attempts_created ON attempts(user_id, created_at);

-- Mistake journal: one row per distinct recurring mistake
CREATE TABLE mistakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  syllabus_point_id INTEGER REFERENCES syllabus_points(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('content_gap','technique','command_term','careless','time_management','terminology','evidence','structure','other')),
  description TEXT NOT NULL,
  correction TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','fixed')),
  repeat_count INTEGER NOT NULL DEFAULT 1,
  review_stage INTEGER NOT NULL DEFAULT 0,
  next_review_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mistakes_user ON mistakes(user_id);
CREATE INDEX idx_mistakes_subject ON mistakes(subject_id);
CREATE INDEX idx_mistakes_syllabus ON mistakes(syllabus_point_id);
CREATE INDEX idx_mistakes_due ON mistakes(user_id, next_review_at);

-- Every time a mistake occurred, with the question and correction at that time
CREATE TABLE mistake_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mistake_id INTEGER NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
  attempt_id INTEGER REFERENCES attempts(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  correction TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_occurrences_user ON mistake_occurrences(user_id);
CREATE INDEX idx_occurrences_mistake ON mistake_occurrences(mistake_id);

-- Spaced-repetition review log
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mistake_id INTEGER NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
  result TEXT NOT NULL CHECK (result IN ('got_it','still_struggling')),
  stage_before INTEGER NOT NULL,
  stage_after INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_reviews_user ON reviews(user_id, reviewed_at);
CREATE INDEX idx_reviews_mistake ON reviews(mistake_id);
