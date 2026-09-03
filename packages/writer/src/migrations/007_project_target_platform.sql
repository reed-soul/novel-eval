-- Target commercial platform for the project (general, fanqie, yanxuan, douban)
ALTER TABLE project ADD COLUMN target_platform TEXT NOT NULL DEFAULT 'general';
