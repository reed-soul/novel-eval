#!/usr/bin/env python3
import sqlite3
import re
import os
import sys

db_path = os.getenv('WRITER_DB_PATH', 'data/writer/writer.db')
target_title = '我给自燃电车做残骸鉴识，电池包出厂日期比整车早了七年'
output_dir = 'research/daily-novels/2026-10-17-ziran-dianchi'

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

        # 脚手架与思维链拦截
        if any(leak in s for leak in [
            '<think>', '</think>', 'The chapter', 'requirements were met',
            '待续路径提示', '【写作蓝图】', '【大纲草稿】', '【本章小结】',
            '下章预告', '欲知后事请看', '请看下回分解'
        ]):
            print(f"[脚手架拦截] 第{pos}章过滤元数据行: {s}")
            continue

        # 幽灵章防范：防范正文中以数字+点或第N回开头的独占行
        if re.match(r'^[0-9]+[、.][0-9]*', s):
            s = '零' + s[1:]
        if re.match(r'^第[0-9一二三四五六七八九十百]+[回节卷]', s):
            s = '从' + s[1:]

        # 章末预告拦截
        if re.search(r'（第[0-9一二三四五六七八九十百]+章完[，、\s]', s) or re.search(r'\(第[0-9一二三四五六七八九十百]+章完[，、\s]', s):
            print(f"[章末预告拦截] 第{pos}章过滤预告行: {s}")
            continue
        if 'http://' in s or 'https://' in s:
            print(f"[URL拦截] 第{pos}章过滤URL行: {s}")
            continue

        body_lines.append(line)

    body_text = "\n".join(body_lines).strip()

    # 技术名词与英文全面意译替换
    replacements = {
        'BMS': '电池管理系统',
        'bms': '电池管理系统',
        'CAN-bus': '控制器局域网络总线',
        'CAN总线': '控制总线',
        'CAN': '控制总线',
        'can总线': '控制总线',
        'SOH': '电池健康度',
        'soh': '电池健康度',
        'SOC': '剩余电量',
        'soc': '剩余电量',
        'Delta V': '单体压差',
        'delta v': '单体压差',
        'DeltaV': '单体压差',
        'ΔV': '单体压差',
        'OBD': '车载诊断接口',
        'obd': '车载诊断接口',
        'App': '应用程序',
        'APP': '应用程序',
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
        'QR码': '二维码',
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
        'Bug': '系统缺陷',
        'bug': '系统缺陷',
        'SQL': '结构化查询',
        'sql': '数据检索',
        'DB': '数据库',
        'db': '数据库',
        'PC': '电脑',
        'pc': '个人电脑',
        'AI': '人工智能',
        'ai': '人工智能',
        'GPS': '卫星定位',
        'gps': '卫星定位',
        'SIM': '通信卡',
        'sim': '通信卡',
        'IC': '芯片',
        'ic': '芯片',
        'hash': '散列校验值',
        'Hash': '散列校验值',
        'HASH': '散列校验值',
        'kWh': '千瓦时',
        'kwh': '千瓦时',
        'KWh': '千瓦时',
        'mV': '毫伏',
        'mv': '毫伏',
        'mΩ': '毫欧',
        'ms': '毫秒',
        'mm': '毫米',
        'cm': '厘米',
        'km': '公里',
        'V': '伏特',
    }
    for k, v in replacements.items():
        body_text = body_text.replace(k, v)

    book_lines.append(body_text)
    book_lines.append("")
    total_chars += len(body_text)

full_book_content = "\n".join(book_lines)

# 清理（本章完）等字样与开放式续集钩
full_book_content = re.sub(r'（本章完）|\(本章完\)|【本章完】|（全文完）|\(全文完\)|【全文完】', '', full_book_content)
full_book_content = re.sub(r'欲知后事如何.*', '', full_book_content)
full_book_content = re.sub(r'未完待续.*', '', full_book_content)

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
    '小满', '温', '霍', '贺', '程', '沈', '祁',
    '粟一宁', '荣三叠', '慎行舟', '乌四海', '来曼', '归晓', '傅阿姨', '秦制片', '段凯',
    '钟宁', '彭守成', '庄叙', '林岚', '郑伟', '陆巡', '孙金宝', '苏佩芸', '曹猛',
    '祁漾', '祁莹', '裴照', '贺兰舟', '娄伯',
    '陆以哲', '莫怀德', '陈恪', '方楚楚', '严九渊', '卢曼青', '潘一舟', '郑启明', '赵德厚',
    '谈笑', '蒲玉兰', '饶静', '蒋岸', '褚安和', '秦婶', '柳映棠',
    '贺连城', '老魏', '沈铎', '纪长河', '毋涛',
    '江承安', '陶明甫', '夏晴', '戴天宏', '崔建德', '邱小凡', '阮晓棠', '谭临舟', '穆砚清',
    '唐越', '严敬山', '宁雪', '徐彪', '赵大发', '陈有福', '陈晓棠', '方雨桐', '宋德全',
    '苗秀兰', '程一诺', '程建国', '陆羽', '袁大爷',
    '晏修远', '钟柏川', '邵远峰', '杜逢春', '庞振海', '左秉成', '苏南星'
]

found_issues = []
for fname in forbidden_names:
    matches = re.findall(re.escape(fname), full_book_content)
    if matches:
        if fname == '温':
            non_name_count = len(re.findall(r'温[和暖水度热柔床情冷饱厚室润]|没有温度|保温|体温|升温|气温|低热|常温|温差|温升|手温|高温预警|高温', full_book_content))
            diff = len(matches) - non_name_count
            if diff > 0:
                found_issues.append((fname, diff))
                print(f"⚠️ 发现「温」姓或可疑温字: 疑似人名 {diff} 处 (总出现 {len(matches)} 处)")
            else:
                print(f"✅ 「温」姓检查通过 (仅出现正常词汇 {non_name_count} 处)")
        elif fname == '程':
            # 程可能出现在 工程、程序、规程、里程、过程、路程、进程、程度 等非人名词汇
            non_name_count = len(re.findall(r'工程|程序|规程|里程|过程|路程|进程|程度|章程|日程|回程|行程|兼程|准程|计程|远程|流程|全程', full_book_content))
            diff = len(matches) - non_name_count
            if diff > 0:
                found_issues.append((fname, diff))
                print(f"⚠️ 发现「程」姓或可疑程字: 疑似人名 {diff} 处 (总出现 {len(matches)} 处)")
            else:
                print(f"✅ 「程」姓检查通过 (仅出现正常词汇 {non_name_count} 处)")
        else:
            found_issues.append((fname, len(matches)))
            print(f"⚠️ 发现禁用词/禁名: {fname} ({len(matches)} 处)")
    else:
        print(f"✅ 禁名检查通过: {fname} (0 命中)")

if not found_issues:
    print("🎉 全部人名与偏好姓氏黑名单检查 100% 通过！")
else:
    print(f"⚠️ 存在人名问题需处理: {found_issues}")
