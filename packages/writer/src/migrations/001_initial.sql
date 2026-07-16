CREATE TABLE project (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  genre_profile TEXT NOT NULL,
  target_audience TEXT NOT NULL,
  premise TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'planning', 'writing', 'completed', 'archived')),
  active_bible_revision_id TEXT REFERENCES story_bible_revision(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE story_bible_revision (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  status TEXT NOT NULL
    CHECK (status IN ('draft', 'approved', 'superseded')),
  bible_json TEXT NOT NULL,
  compiled_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, revision_number)
) STRICT;

CREATE TABLE beat (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  bible_revision_id TEXT NOT NULL REFERENCES story_bible_revision(id),
  position INTEGER NOT NULL CHECK (position > 0),
  act INTEGER NOT NULL CHECK (act > 0),
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, position)
) STRICT;

CREATE TABLE chapter_outline (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'writing', 'written', 'stale')),
  active_revision_id TEXT REFERENCES chapter_outline_revision(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, position)
) STRICT;

CREATE TABLE chapter_outline_revision (
  id TEXT PRIMARY KEY,
  outline_id TEXT NOT NULL REFERENCES chapter_outline(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  status TEXT NOT NULL
    CHECK (status IN ('draft', 'approved', 'superseded')),
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (outline_id, revision_number)
) STRICT;

CREATE TABLE chapter (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  outline_id TEXT NOT NULL UNIQUE REFERENCES chapter_outline(id),
  active_revision_id TEXT REFERENCES chapter_revision(id),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE chapter_revision (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  source TEXT NOT NULL
    CHECK (source IN ('generated', 'manual', 'correction', 'import')),
  parent_revision_id TEXT REFERENCES chapter_revision(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  word_count INTEGER NOT NULL CHECK (word_count >= 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'rejected')),
  generation_run_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (chapter_id, revision_number)
) STRICT;

CREATE TABLE story_state_revision (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  chapter_revision_id TEXT NOT NULL UNIQUE REFERENCES chapter_revision(id),
  previous_state_revision_id TEXT REFERENCES story_state_revision(id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  status TEXT NOT NULL
    CHECK (status IN ('current', 'stale', 'failed')),
  state_json TEXT NOT NULL,
  delta_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX story_state_one_current_sequence
  ON story_state_revision(project_id, sequence)
  WHERE status = 'current';

CREATE TABLE job (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  input_json TEXT NOT NULL,
  engine TEXT NOT NULL,
  model TEXT NOT NULL,
  word_count INTEGER NOT NULL CHECK (word_count >= 0),
  quality_profile TEXT NOT NULL,
  budget_json TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  checkpoint_json TEXT,
  last_outline_position INTEGER NOT NULL DEFAULT 0 CHECK (last_outline_position >= 0),
  usage_json TEXT,
  error_type TEXT,
  retry_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE project_write_lease (
  id TEXT NOT NULL UNIQUE,
  project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
