#!/usr/bin/env bash
set -e

export WRITER_DB_PATH="data/writer/writer.db"

TOPIC_CONTENT=$(cat research/daily-novels/2026-10-07-topic.txt)

echo "Starting writer auto pipeline for 2026-10-07..."
pnpm write auto \
  --title "我给查封老宅做产权核验，档案里的原房主死后第三年签了字" \
  --genre "现实社会派悬疑" \
  --audience "通用" \
  --platform fanqie \
  --chapters 18 \
  --word-count 2600 \
  -y \
  --approve-planning \
  --topic "$TOPIC_CONTENT"
