-- Rebuild appends a new current ledger row for the same active chapter revision
-- while prior rows stay stale and immutable. Drop the one-state-per-revision rule.
PRAGMA foreign_keys = OFF;

CREATE TABLE story_state_revision_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  chapter_revision_id TEXT NOT NULL REFERENCES chapter_revision(id),
  previous_state_revision_id TEXT REFERENCES story_state_revision_new(id),
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

INSERT INTO story_state_revision_new (
  id, project_id, chapter_id, chapter_revision_id, previous_state_revision_id,
  sequence, status, state_json, delta_json, summary, model, prompt_version, created_at
)
SELECT
  id, project_id, chapter_id, chapter_revision_id, previous_state_revision_id,
  sequence, status, state_json, delta_json, summary, model, prompt_version, created_at
FROM story_state_revision
ORDER BY sequence ASC, created_at ASC;

DROP TABLE story_state_revision;

ALTER TABLE story_state_revision_new RENAME TO story_state_revision;

CREATE UNIQUE INDEX story_state_one_current_sequence
  ON story_state_revision(project_id, sequence)
  WHERE status = 'current';

PRAGMA foreign_keys = ON;
