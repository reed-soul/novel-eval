#!/usr/bin/env bash
set -e

# 加载 API Key
if [ -f "$HOME/.claude/settings.json" ]; then
  export ANTHROPIC_AUTH_TOKEN=$(python3 -c "import json;print(json.load(open('$HOME/.claude/settings.json')).get('env',{}).get('ANTHROPIC_AUTH_TOKEN',''))")
  export DEEPSEEK_API_KEY=$(python3 -c "import json;print(json.load(open('$HOME/.claude/settings.json')).get('env',{}).get('DEEPSEEK_API_KEY',''))")
fi

export WRITER_DB_PATH="data/writer/writer.db"
BOOK_TITLE="我给母亲领靶向药，扫出十年前过世父亲的医保单"
TOPIC_FILE="research/daily-novels/2026-10-02-topic-night.txt"

echo "=== 启动写作管线: 《$BOOK_TITLE》 ==="
TOPIC_CONTENT=$(cat "$TOPIC_FILE")

# 1. 尝试 auto
MAX_RETRIES=5
SUCCESS=0

for i in $(seq 1 $MAX_RETRIES); do
  echo "--- auto 尝试第 $i 次 ---"
  if pnpm write auto --title "$BOOK_TITLE" --genre "现实社会派悬疑" --audience "通用" --platform "fanqie" --chapters 18 --word-count 2600 -y --approve-planning --topic "$TOPIC_CONTENT"; then
    echo "auto 成功完成！"
    SUCCESS=1
    break
  else
    echo "auto 中断或出错，检查是否有半成品项目可 resume..."
    # 查找匹配书名的最新 projectId
    PROJECT_ID=$(python3 -c "
import sqlite3
conn = sqlite3.connect('data/writer/writer.db')
c = conn.cursor()
c.execute(\"SELECT id FROM project WHERE title = '$BOOK_TITLE' ORDER BY created_at DESC LIMIT 1\")
row = c.fetchone()
if row:
    print(row[0])
")
    if [ -n "$PROJECT_ID" ]; then
      echo "发现项目 ID: $PROJECT_ID，尝试 resume 续写..."
      for r in $(seq 1 5); do
        echo "resume 尝试第 $r 次..."
        if pnpm write resume "$PROJECT_ID"; then
          # 检查是否已完成 18 章
          WRITTEN_COUNT=$(python3 -c "
import sqlite3
conn = sqlite3.connect('data/writer/writer.db')
c = conn.cursor()
c.execute(\"SELECT count(*) FROM chapter WHERE project_id = '$PROJECT_ID'\")
print(c.fetchone()[0])
")
          if [ "$WRITTEN_COUNT" -ge 18 ]; then
            echo "项目 $PROJECT_ID 已完成 $WRITTEN_COUNT 章！"
            SUCCESS=1
            break 2
          fi
        else
          echo "resume 中断，等待 10 秒后重试..."
          sleep 10
        fi
      done
    fi
    echo "等待 15 秒后重试 auto..."
    sleep 15
  fi
done

if [ "$SUCCESS" -eq 1 ]; then
  echo "=== 全管线写作圆满完成！ ==="
else
  echo "=== 写作未能在最大重试内完成 ==="
  exit 1
fi
