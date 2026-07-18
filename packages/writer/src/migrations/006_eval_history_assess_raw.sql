-- Persist assessChapters payload for quality-gate forensics.
ALTER TABLE eval_history ADD COLUMN assess_raw TEXT;
