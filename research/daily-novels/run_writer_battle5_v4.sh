#!/usr/bin/env bash
set -e

# battle5 v4 验证本：现行生产规格（9节/1600字/yanxuan/第一人称），守村人题材
# 处方栈：v3 全部 + v4 三项（残渣清理在导出侧 / resume 闸门 / 人名锁定 / 情感双层落地）
export ANTHROPIC_AUTH_TOKEN=$(python3 -c "import json;print(json.load(open('$HOME/.claude/settings.json')).get('env',{}).get('ANTHROPIC_AUTH_TOKEN',''))")
export DEEPSEEK_API_KEY=$(python3 -c "import json;print(json.load(open('$HOME/.claude/settings.json')).get('env',{}).get('DEEPSEEK_API_KEY',''))")
export WRITER_DB_PATH="data/writer/writer.db"

TITLE="守村人替劫v4验证本"
TOPIC_FILE="research/daily-novels/2026-10-24-shoucunren/topic.txt"
TOPIC_CONTENT=$(cat "$TOPIC_FILE")
LOG_FILE="research/daily-novels/writer_battle5_v4.log"

for i in 1 2 3 4 5; do
  echo "--- [$TITLE] auto 尝试第 $i 次 ---" | tee -a "$LOG_FILE"
  if pnpm write auto --title "$TITLE" --genre "中式民俗怪谈悬疑" --audience "通用" \
      --platform "yanxuan" --chapters 9 --word-count 1600 --max-revise 3 -y \
      --approve-planning --topic "$TOPIC_CONTENT" 2>&1 | tee -a "$LOG_FILE"; then
    echo "=== [$TITLE] 成功 ===" | tee -a "$LOG_FILE"
    exit 0
  fi
  PROJECT_ID=$(python3 -c "
import sqlite3
conn = sqlite3.connect('data/writer/writer.db')
c = conn.cursor()
c.execute(\"SELECT id FROM project WHERE title = '$TITLE' ORDER BY created_at DESC LIMIT 1\")
row = c.fetchone()
print(row[0] if row else '')
")
  if [ -n "$PROJECT_ID" ]; then
    echo "[$TITLE] resume: $PROJECT_ID（v4 起 resume 默认带质量闸门）" | tee -a "$LOG_FILE"
    pnpm write resume "$PROJECT_ID" -y --max-revise 3 2>&1 | tee -a "$LOG_FILE" && exit 0
  fi
done
echo "=== 全部重试失败 ===" | tee -a "$LOG_FILE"
exit 1
