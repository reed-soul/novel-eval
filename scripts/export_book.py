#!/usr/bin/env python3
import sqlite3
import re
import os
import sys

db_path = os.getenv('WRITER_DB_PATH', 'data/writer/writer.db')
target_title = sys.argv[1] if len(sys.argv) > 1 else '我给母亲领靶向药，扫出十年前过世父亲的医保单'
output_dir = sys.argv[2] if len(sys.argv) > 2 else 'research/daily-novels/2026-10-02-yaofang-yibaodan'

print(f"=== 正在拼书与自检: 《{target_title}》 ===")
conn = sqlite3.connect(db_path)
c = conn.cursor()

c.execute("SELECT id, title, status FROM project WHERE title = ? ORDER BY created_at DESC LIMIT 1", (target_title,))
row = c.fetchone()
if not row:
    print(f"❌ 未找到项目: 《{target_title}》")
    sys.exit(1)

project_id, title, status = row
print(f"项目 ID: {project_id} | 状态: {status}")

query = """
SELECT 
    co.position,
    cor.title as outline_title,
    cr.title as revision_title,
    cr.content,
    cr.word_count
FROM chapter c
JOIN chapter_outline co ON c.outline_id = co.id
LEFT JOIN chapter_outline_revision cor ON co.active_revision_id = cor.id
JOIN chapter_revision cr ON c.active_revision_id = cr.id
WHERE c.project_id = ?
ORDER BY co.position ASC
"""

c.execute(query, (project_id,))
chapters = c.fetchall()
print(f"找到章节数: {len(chapters)}")
if len(chapters) == 0:
    print("❌ 章节数为 0")
    sys.exit(1)

os.makedirs(output_dir, exist_ok=True)
book_path = os.path.join(output_dir, 'book.md')

book_lines = []
total_chars = 0

for pos, outline_title, rev_title, content, word_count in chapters:
    # 提取纯章节名（去掉“第N章”、“第 N 章”、“第一章”等前缀）
    raw_title = rev_title or outline_title or f"第{pos}章"
    clean_title = re.sub(r'^(第[0-9一二三四五六七八九十百]+章|[0-9]+)\s*[:：、\-—\s]*', '', raw_title).strip()
    if not clean_title:
        clean_title = f"第{pos}章"
    
    chapter_header = f"# 第{pos}章 {clean_title}"
    book_lines.append(chapter_header)
    book_lines.append("")

    # 处理正文：剥离 content 前部自带的各种标题层
    lines = content.strip().splitlines()
    body_lines = []
    skip_header = True

    for line in lines:
        s = line.strip()
        # 跳过开头的标题行
        if skip_header:
            if re.match(r'^#*\s*第[0-9一二三四五六七八九十百]+章', s) or re.match(r'^第[0-9一二三四五六七八九十百]+章', s):
                continue
            if s == clean_title or s == raw_title:
                continue
            if not s:
                continue
            skip_header = False

        # 脚手架与元数据泄漏拦截
        if any(leak in s for leak in ['待续路径提示', '【写作蓝图】', '【大纲草稿】', '【本章小结】', '下章预告']):
            print(f"[脚手架拦截] 第{pos}章过滤元数据行: {s}")
            continue

        body_lines.append(line)

    body_text = "\n".join(body_lines).strip()
    book_lines.append(body_text)
    book_lines.append("")
    total_chars += len(body_text)

full_book = "\n".join(book_lines)
with open(book_path, 'w', encoding='utf-8') as f:
    f.write(full_book)

print(f"\n✅ 拼书完成：{book_path}")
print(f"总字数（正文字符数）: {total_chars} 字 | 章节数: {len(chapters)} 章")

# --- 严格质量自检 ---
print("\n--- 开始文本合规与质量自检 ---")

# 1. 英文残留
en_matches = re.findall(r'[A-Za-z]{2,}', full_book)
if en_matches:
    print(f"⚠ 发现英文字符串残留 ({len(en_matches)} 处): {list(set(en_matches))[:15]}")
else:
    print("✅ 纯中文零英文残留: 通过 (0 处英文字符串)")

# 2. 禁名与偏好姓氏
blacklist = [
    '小满',
    '温以宁', '温以蘅', '温昭', '温若蘅',
    '纪桐', '孟叙白', '阚伯', '池羽', '路之衍', '贺明霜', '聂霜', '霍岑',
    '柯万山', '聂虹', '米露', '韩澈', '林嘉', '方砚', '祁烨', '陈晓蔓',
    '雷正坤', '周秀兰', '贺云笙', '盛清让', '齐慕荪', '贺照野', '周鹤年',
    '贺振农', '林欢桐', '麦冬', '陆沉', '程一格', '关雨眠', '沈淮安',
    '陆承泽', '宋文渊', '秦素', '何平', '赵立新', '陆岩', '陆天成',
    '童长海', '裴定安', '童舒', '苏晚潮', '贺一刀',
    '顾巡', '顾建平', '梁咏梅', '严兆明', '薛宝成', '叶青梧', '廖崇德', '秦克', '廖念真', '周砚秋',
    '沈停云', '戚秉忠', '戚秉中', '齐烈', '巴延海', '岳小刀', '贺连城', '池小禾', '祝明川', '顾则鸣', '裴真', '阎克敬'
]

hits = 0
for name in blacklist:
    cnt = len(re.findall(re.escape(name), full_book))
    if cnt > 0:
        print(f"❌ 命中黑名单禁名: '{name}' 出现 {cnt} 次")
        hits += 1

# 检查温姓角色
wen_matches = re.findall(r'温[一-龥]{1,2}(?=[，。！？\s说走了道])', full_book)
safe_words = ['温度', '温控', '温水', '体温', '温热', '恒温', '温润', '温暖', '升温', '降温', '保温', '炉温', '气温', '温桶', '温杯', '温箱']
illegal_wen = [w for w in wen_matches if not any(w.startswith(sw) or sw in w for sw in safe_words)]
if illegal_wen:
    print(f"❌ 发现可能违禁的温姓人名: {list(set(illegal_wen))}")
    hits += 1

if hits == 0:
    print("✅ 人名合规自检通过: 无「小满」、无「温」姓角色、无近 10 部历史人物撞名")

print("--- 自检完毕 ---")
