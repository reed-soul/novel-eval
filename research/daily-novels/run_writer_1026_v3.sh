#!/usr/bin/env bash
set -e

# v3 验证本（P0-6）：开质量门槛跑 2 本（仅验证期取优，严禁生产使用）
# 处方：锚点活体在场律 / emotional_anchor / 物证人性并轨 / 情感闸门85 / 行为级纠偏
export ANTHROPIC_AUTH_TOKEN=$(python3 -c "import json;print(json.load(open('$HOME/.claude/settings.json')).get('env',{}).get('ANTHROPIC_AUTH_TOKEN',''))")
export DEEPSEEK_API_KEY=$(python3 -c "import json;print(json.load(open('$HOME/.claude/settings.json')).get('env',{}).get('DEEPSEEK_API_KEY',''))")
export WRITER_DB_PATH="data/writer/writer.db"

TOPIC_FILE="research/daily-novels/2026-10-24-shoucunren/topic.txt"
TOPIC_CONTENT=$(cat "$TOPIC_FILE")
LOG_FILE="research/daily-novels/writer_1026_v3.log"

run_one() {
  local TITLE="$1"
  for i in 1 2 3 4 5; do
    echo "--- [$TITLE] auto 尝试第 $i 次 ---" | tee -a "$LOG_FILE"
    if pnpm write auto --title "$TITLE" --genre "中式民俗怪谈悬疑" --audience "通用" --platform "fanqie" --chapters 18 --word-count 2800 --max-revise 3 -y --approve-planning --topic "$TOPIC_CONTENT" 2>&1 | tee -a "$LOG_FILE"; then
      echo "=== [$TITLE] 成功 ===" | tee -a "$LOG_FILE"
      return 0
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
      echo "[$TITLE] resume: $PROJECT_ID" | tee -a "$LOG_FILE"
      pnpm write resume "$PROJECT_ID" -y --max-revise 3 2>&1 | tee -a "$LOG_FILE" && return 0
    fi
  done
  echo "=== [$TITLE] 全部重试失败 ===" | tee -a "$LOG_FILE"
  return 1
}

echo "=== v3 验证启动: $(date) ===" | tee -a "$LOG_FILE"
run_one "守村人替劫v3验证本A"
echo "--- 间隔 90s 防限流 ---" | tee -a "$LOG_FILE"
sleep 90
run_one "守村人替劫v3验证本B"
echo "=== 双本完成: $(date) ===" | tee -a "$LOG_FILE"
