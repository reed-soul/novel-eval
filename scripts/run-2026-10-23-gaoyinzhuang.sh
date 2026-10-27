#!/usr/bin/env bash
set -e

# 《告阴状》手动加跑（10-23 槽）· 错峰闸：等今晚定时任务（10-22 槽）收工后再串行起跑
cd /Users/reed_soul/code/novel-eval

if [ -f "$HOME/.claude/settings.json" ]; then
  export ANTHROPIC_AUTH_TOKEN=$(python3 -c "import json;print(json.load(open('$HOME/.claude/settings.json')).get('env',{}).get('ANTHROPIC_AUTH_TOKEN',''))")
  export DEEPSEEK_API_KEY=$(python3 -c "import json;print(json.load(open('$HOME/.claude/settings.json')).get('env',{}).get('DEEPSEEK_API_KEY',''))")
fi
export WRITER_DB_PATH="data/writer/writer.db"

BOOK_TITLE="阳间告不倒的恶人，她烧了张状纸给城隍爷"
TOPIC_FILE="research/daily-novels/2026-10-23-topic.txt"
LOG="research/daily-novels/writer_1023-gaoyinzhuang.log"

wait_until_clear () {
  # 错峰闸：等到 06:00（定时任务 03:30 触发、约 2~2.5h 跑完）且产线进程清零
  TARGET=$(python3 -c "
import datetime as dt
now = dt.datetime.now()
t = now.replace(hour=6, minute=0, second=0, microsecond=0)
if now >= t: t += dt.timedelta(days=1)
print(int(t.timestamp()))")
  while [ "$(date +%s)" -lt "$TARGET" ]; do sleep 300; done
  for i in $(seq 1 36); do
    BUSY=$(ps aux | grep "novel-eval" | grep -E "pnpm|node|tsx" | grep -vE "grep|run-2026-10-23-gaoyinzhuang" | grep -vc "^$" || true)
    if [ "${BUSY:-0}" -eq 0 ]; then echo "=== [闸门] 产线空闲，放行 ==="; return 0; fi
    echo "  产线仍有 ${BUSY} 个进程，5 分钟后再查（第 $i/36 次）"; sleep 300
  done
}

deadline_guard () {
  # 03:00~06:00 窗口内暂停（定时任务 03:30 触发，留半小时清场）；窗口外直接放行
  H=$(date +%H); M=$(date +%M); NOW_MIN=$((10#$H*60+10#$M))
  if [ "$NOW_MIN" -ge 180 ] && [ "$NOW_MIN" -lt 360 ]; then
    echo "=== [安全阀] 处于 03:00-06:00 定时任务窗口，暂停写作 ==="
    wait_until_clear
  fi
}

echo "=== [启动] 立即开跑（03:00 安全阀 + 06:00 错峰闸保护） ==="

echo "=== 启动写作管线: 《$BOOK_TITLE》 ==="
TOPIC_CONTENT=$(cat "$TOPIC_FILE")

MAX_RETRIES=5
SUCCESS=0
for i in $(seq 1 $MAX_RETRIES); do
  echo "--- auto 尝试第 $i 次 ---"
  deadline_guard
  if pnpm write auto --title "$BOOK_TITLE" --genre "现实社会派悬疑" --audience "通用" --platform "fanqie" --chapters 18 --word-count 2600 -y --approve-planning --topic "$TOPIC_CONTENT"; then
    echo "auto 成功完成！"; SUCCESS=1; break
  else
    echo "auto 中断或出错，检查半成品项目 resume..."
    PROJECT_ID=$(python3 -c "
import sqlite3
conn = sqlite3.connect('data/writer/writer.db')
c = conn.cursor()
c.execute(\"SELECT id FROM project WHERE title = '$BOOK_TITLE' ORDER BY created_at DESC LIMIT 1\")
row = c.fetchone()
if row: print(row[0])")
    if [ -n "$PROJECT_ID" ]; then
      echo "发现项目 ID: $PROJECT_ID，尝试 resume..."
      for r in $(seq 1 5); do
        echo "resume 尝试第 $r 次..."
        deadline_guard
        if pnpm write resume "$PROJECT_ID"; then
          WRITTEN_COUNT=$(python3 -c "
import sqlite3
conn = sqlite3.connect('data/writer/writer.db')
c = conn.cursor()
c.execute(\"SELECT count(*) FROM chapter WHERE project_id = '$PROJECT_ID'\")
print(c.fetchone()[0])")
          if [ "$WRITTEN_COUNT" -ge 18 ]; then echo "项目 $PROJECT_ID 已完成 $WRITTEN_COUNT 章！"; SUCCESS=1; break 2; fi
        else
          echo "resume 中断，10 秒后重试..."; sleep 10
        fi
      done
    fi
    echo "15 秒后重试 auto..."; sleep 15
  fi
done

if [ "$SUCCESS" -eq 1 ]; then
  echo "=== [告阴状] 写作管线圆满完成 ==="
else
  echo "=== [告阴状] 未能在最大重试内完成 ==="; exit 1
fi
