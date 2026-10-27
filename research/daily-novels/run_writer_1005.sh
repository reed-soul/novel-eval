#!/usr/bin/env bash
set -e

export WRITER_DB_PATH="data/writer/writer.db"

TOPIC_CONTENT=$(cat research/daily-novels/2026-10-05-topic.txt)

echo "Starting writer auto pipeline..."
pnpm write auto \
  --title "我给三十层商厦做消防检测，消控主机报出的起火点在地下第四层" \
  --genre "现实社会派悬疑" \
  --audience "通用" \
  --platform fanqie \
  --chapters 18 \
  --word-count 2600 \
  -y \
  --approve-planning \
  --topic "$TOPIC_CONTENT"
