#!/usr/bin/env bash
set -e

export WRITER_DB_PATH="data/writer/writer.db"
TOPIC_FILE="research/daily-novels/2026-10-10-topic.txt"
LOG_FILE="research/daily-novels/writer_1010.log"

TITLE="我给化工厂测地下水，七个取样井里抽出来的都是自来水"

echo "=== 启动 2026-10-10 小说全管线自动生成 ===" | tee -a "$LOG_FILE"
echo "书名: $TITLE" | tee -a "$LOG_FILE"
echo "时间: $(date)" | tee -a "$LOG_FILE"

TOPIC_CONTENT=$(cat "$TOPIC_FILE")

# 运行 auto
pnpm write auto \
  --title "$TITLE" \
  --genre "现实社会派悬疑" \
  --audience "通用" \
  --platform fanqie \
  --chapters 18 \
  --word-count 2600 \
  -y \
  --approve-planning \
  --topic "$TOPIC_CONTENT" 2>&1 | tee -a "$LOG_FILE"

echo "=== auto 命令执行完成，检查项目状态 ===" | tee -a "$LOG_FILE"
