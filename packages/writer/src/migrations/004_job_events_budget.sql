-- Durable per-job progress events for resumable SSE after process restart.
CREATE TABLE job_event (
  job_id TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq > 0),
  step TEXT NOT NULL,
  msg TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (job_id, seq)
) STRICT;

CREATE INDEX job_event_job_id_seq ON job_event(job_id, seq);

-- Speeds up active-job lookups used by hasActiveJob / getActiveJob.
CREATE INDEX job_project_status ON job(project_id, status);
