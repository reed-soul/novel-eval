#!/usr/bin/env bash
set -e

# 处方验证本：双盲评处方落地后，守村人同题材重跑管线全本
# 目的：验证处方（人物硬下限/灵异规则契约/主角智斗/行为语言塑造）对产出质量的提升
export ANTHROPIC_AUTH_TOKEN=$(python3 -c "import json;print(json.load(open('$HOME/.claude/settings.json')).get('env',{}).get('ANTHROPIC_AUTH_TOKEN',''))")
export DEEPSEEK_API_KEY=$(python3 -c "import json;print(json.load(open('$HOME/.claude/settings.json')).get('env',{}).get('DEEPSEEK_API_KEY',''))")
export WRITER_DB_PATH="data/writer/writer.db"

BOOK_TITLE="守村人替劫：处方验证本"
TOPIC_FILE="research/daily-novels/2026-10-24-shoucunren/topic.txt"
LOG_FILE="research/daily-novels/writer_1025_v2.log"

echo "=== 处方验证本启动: $(date) ===" | tee -a "$LOG_FILE"
TOPIC_CONTENT=$(cat "$TOPIC_FILE")

MAX_RETRIES=5
for i in $(seq 1 $MAX_RETRIES); do
  echo "--- auto 尝试第 $i 次 ---" | tee -a "$LOG_FILE"
  if pnpm write auto --title "$BOOK_TITLE" --genre "中式民俗怪谈悬疑" --audience "通用" --platform "fanqie" --chapters 18 --word-count 2800 -y --approve-planning --topic "$TOPIC_CONTENT" 2>&1 | tee -a "$LOG_FILE"; then
    echo "=== auto 成功: $(date) ===" | tee -a "$LOG_FILE"
    exit 0
  fi
  echo "auto 中断，尝试 resume..." | tee -a "$LOG_FILE"
  PROJECT_ID=$(python3 -c "
import sqlite3
conn = sqlite3.connect('data/writer/writer.db')
c = conn.cursor()
c.execute(\"SELECT id FROM project WHERE title = '$BOOK_TITLE' ORDER BY created_at DESC LIMIT 1\")
row = c.fetchone()
print(row[0] if row else '')
")
  if [ -n "$PROJECT_ID" ]; then
    echo "resume 项目: $PROJECT_ID" | tee -a "$LOG_FILE"
    pnpm write resume "$PROJECT_ID" -y 2>&1 | tee -a "$LOG_FILE" && { echo "=== resume 成功 ===" | tee -a "$LOG_FILE"; exit 0; }
  fi
done
echo "=== 全部重试失败 ===" | tee -a "$LOG_FILE"
exit 1
