#!/usr/bin/env python3
import sqlite3
import re
import os
import sys

db_path = os.getenv('WRITER_DB_PATH', 'data/writer/writer.db')
target_title = '我每天吃七五折的快餐，查出账单洗了八千万'
output_dir = 'research/daily-novels/2026-10-15-kuaican-zhangdan'

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
    c.id as chapter_id,
    c.active_revision_id,
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

for chap_id, rev_id, pos, outline_title, rev_title, content, word_count in chapters:
    raw_title = rev_title or outline_title or f"第{pos}章"
    clean_title = re.sub(r'^(第[0-9一二三四五六七八九十百]+章|[0-9]+)\s*[:：、\-—\s]*', '', raw_title).strip()
    if not clean_title:
        clean_title = f"第{pos}章"
    
    chapter_header = f"# 第{pos}章 {clean_title}"
    book_lines.append(chapter_header)
    book_lines.append("")

    lines = content.strip().splitlines()
    body_lines = []
    skip_header = True

    for line in lines:
        s = line.strip()
        if skip_header:
            if re.match(r'^#*\s*第[0-9一二三四五六七八九十百]+章', s) or re.match(r'^第[0-9一二三四五六七八九十百]+章', s):
                continue
            if s == clean_title or s == raw_title or s == f"《{clean_title}》":
                continue
            if not s:
                continue
            skip_header = False

        if any(leak in s for leak in ['待续路径提示', '【写作蓝图】', '【大纲草稿】', '【本章小结】', '下章预告', '欲知后事请看']):
            print(f"[脚手架拦截] 第{pos}章过滤元数据行: {s}")
            continue
        if re.search(r'（第[0-9一二三四五六七八九十百]+章完[，、\s]', s) or re.search(r'\(第[0-9一二三四五六七八九十百]+章完[，、\s]', s):
            print(f"[章末预告拦截] 第{pos}章过滤预告行: {s}")
            continue
        if 'http://' in s or 'https://' in s:
            print(f"[URL拦截] 第{pos}章过滤URL行: {s}")
            continue

        body_lines.append(line)

    body_text = "\n".join(body_lines).strip()

    # 技术名词与英文清洗
    replacements = {
        'App': '软件',
        'APP': '软件',
        'app': '软件',
        'ID': '账号',
        'id': '账号',
        'IP': '网络地址',
        'ip': '网络地址',
        'API': '数据接口',
        'api': '数据接口',
        'Server': '服务器',
        'server': '服务器',
        'URL': '链接',
        'url': '链接',
        'QR': '二维码',
        'qr': '二维码',
        'LED': '发光二极管',
        'led': '发光二极管',
        'USB': '通用串行总线',
        'usb': '通用串行总线',
        'U盘': '加密闪存盘',
        'u盘': '加密闪存盘',
        'POS机': '刷卡终端',
        'POS': '刷卡终端',
        'pos机': '刷卡终端',
        'pos': '刷卡终端',
        'Token': '令牌',
        'token': '令牌',
        'Log': '操作日志',
        'log': '日志',
        'Bug': '漏洞缺陷',
        'bug': '系统缺陷',
        'SQL': '结构化查询',
        'sql': '数据检索',
        'DB': '数据库',
        'db': '数据库',
        'PC': '电脑',
        'pc': '个人电脑',
        'AI': '人工智能',
        'ai': '人工智能',
        'hash': '散列校验值',
        'Hash': '散列校验值',
        'HASH': '散列校验值',
    }
    for k, v in replacements.items():
        body_text = body_text.replace(k, v)

    book_lines.append(body_text)
    book_lines.append("")
    total_chars += len(body_text)

full_book_content = "\n".join(book_lines)

# 清理（本章完）等字样
full_book_content = re.sub(r'（本章完）|\(本章完\)|【本章完】', '', full_book_content)

with open(book_path, 'w', encoding='utf-8') as f:
    f.write(full_book_content)

print(f"✅ 拼书完成: {book_path}")
print(f"总字数: {total_chars} 字符")

# 检查英文残留
en_matches = re.findall(r'[A-Za-z]{2,}', full_book_content)
if en_matches:
    print(f"⚠️ 发现英文单词残留 ({len(en_matches)} 处): {set(en_matches)}")
else:
    print("✅ 纯中文 0 英文残留检查通过！")

# 检查禁名人名
forbidden_names = [
    '小满', '温', '霍', '贺', '桑也', '糜广居', '娄伯', '牟唯', '边响', '翟莹',
    '裴照', '祁漾', '祁莹', '贺兰舟', '陆以哲', '莫怀德', '陈恪', '方楚楚', '严九渊',
    '卢曼青', '潘一舟', '郑启明', '赵德厚', '阮青梧', '屠文彬', '阎朗', '贺沉舟',
    '牛劲松', '康伯', '杭晚', '沈蜜', '甘露', '费驰', '贺连城', '鲁小舟', '桂香',
    '老魏', '穆砚清', '崔建德', '谭临舟', '阮晓棠', '骆一苇', '唐叙白', '庞振海',
    '林晚', '陆峰', '周桂芬', '陈浩', '何建军', '唐越', '严敬山', '宁雪', '陈有福',
    '宋德全', '程一诺', '苗秀兰', '蒋岸', '褚安和', '谈笑', '蒲玉兰', '饶静', '秦婶', '柳映棠'
]

found_issues = []
for fname in forbidden_names:
    matches = re.findall(fname, full_book_content)
    if matches:
        if fname == '温':
            # 过滤正常词汇：温和、温暖、温水、保温、温度、体温、温热、升温
            non_name_count = len(re.findall(r'温[和暖水度热柔床情冷饱厚]|没有温度|保温|体温|升温|气温|低热|常温', full_book_content))
            diff = len(matches) - non_name_count
            if diff > 0:
                found_issues.append((fname, diff))
                print(f"⚠️ 发现「温」姓或可疑温字: 疑似人名 {diff} 处 (总出现 {len(matches)} 处)")
            else:
                print(f"✅ 「温」姓检查通过 (仅出现正常词汇 {non_name_count} 处)")
        else:
            found_issues.append((fname, len(matches)))
            print(f"⚠️ 发现禁用词/禁名: {fname} ({len(matches)} 处)")
    else:
        print(f"✅ 禁名检查通过: {fname} (0 命中)")

if not found_issues:
    print("🎉 全部人名与偏好姓氏黑名单检查 100% 通过！")
else:
    print(f"⚠️ 存在人名问题需处理: {found_issues}")
