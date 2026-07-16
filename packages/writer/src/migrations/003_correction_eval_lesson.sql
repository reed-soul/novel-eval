-- Side tables for diagnose / correct / lesson aggregation.
-- Previously created ad-hoc in tests; required for fresh DBs.

CREATE TABLE correction_draft (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL CHECK (chapter_number > 0),
  strategy TEXT NOT NULL
    CHECK (strategy IN ('surgical', 'rewrite')),
  original_content TEXT NOT NULL,
  revised_content TEXT NOT NULL,
  original_score REAL,
  revised_score REAL,
  issues_json TEXT,
  changes_json TEXT,
  revised_result_json TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'adopted', 'discarded')),
  engine TEXT,
  job_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE eval_history (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL CHECK (chapter_number > 0),
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  verdict TEXT NOT NULL
    CHECK (verdict IN ('pass', 'revise', 'block')),
  total_score REAL,
  grade TEXT,
  dimensions TEXT,
  suggestions TEXT,
  repetition TEXT,
  model TEXT,
  evaluator_model TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE lesson_learned (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES project(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  dimension TEXT,
  avg_score REAL NOT NULL,
  common_issues TEXT,
  effective_fixes TEXT,
  occurrence_count INTEGER NOT NULL CHECK (occurrence_count > 0),
  updated_at TEXT NOT NULL
) STRICT;
