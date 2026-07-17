-- Revision tasks: reviewable checklist derived from evaluation suggestions (MVP).
-- Does not auto-rewrite chapter content.

CREATE TABLE revision_task (
  id TEXT NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done', 'dismissed')),
  scope TEXT NOT NULL
    CHECK (scope IN ('chapter', 'volume', 'book')),
  dimension TEXT,
  content TEXT NOT NULL,
  type TEXT,
  related_chapters_json TEXT NOT NULL DEFAULT '[]',
  excerpt_ref_json TEXT,
  source_eval_task_id TEXT,
  source_kind TEXT NOT NULL DEFAULT 'evaluation_report'
    CHECK (source_kind IN ('evaluation_report', 'manual')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX revision_task_project_status
  ON revision_task(project_id, status);

CREATE INDEX revision_task_source_eval
  ON revision_task(source_eval_task_id)
  WHERE source_eval_task_id IS NOT NULL;
