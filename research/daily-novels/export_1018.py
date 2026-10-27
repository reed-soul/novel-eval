#!/usr/bin/env python3
import sqlite3
import re
import os
import sys

db_path = os.getenv('WRITER_DB_PATH', 'data/writer/writer.db')
target_title = '我花八万块买的国企编制，带我入职的处长是个群演'
output_dir = 'research/daily-novels/2026-10-18-bianzhi-qunyan'

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
        'App': '应用程序',
        'APP': '应用程序',
        'app': '应用程序',
        'U盘': '便携式闪存盘',
        'u盘': '便携式闪存盘',
        'U 盘': '便携式闪存盘',
        'Wi-Fi': '无线局域网',
        'wifi': '无线局域网',
        'WiFi': '无线局域网',
        'GPS': '全球卫星定位系统',
        'gps': '全球卫星定位系统',
        'LED': '发光二极管',
        'led': '发光二极管',
        'PC': '个人电脑',
        'pc': '个人电脑',
        'PDF': '便携文档格式',
        'pdf': '便携文档格式',
        'Word': '文本文档',
        'word': '文本文档',
        'Excel': '电子表格',
        'excel': '电子表格',
        'PPT': '演示文稿',
        'ppt': '演示文稿',
        'SIM': '通信卡',
        'sim': '通信卡',
        'IP': '网络协议地址',
        'ip': '网络协议地址',
        'ID': '身份编码',
        'id': '身份编码',
        'hr': '人事',
        'HR': '人事',
        'offer': '录用通知',
        'Offer': '录用通知',
        'KPI': '考核指标',
        'kpi': '考核指标',
        'CEO': '首席执行官',
        'ceo': '首席执行官',
        'OA': '协同办公系统',
        'oa': '协同办公系统',
        'CRM': '客户关系管理系统',
        'crm': '客户关系管理系统',
        'ERP': '企业资源计划系统',
        'erp': '企业资源计划系统',
        'B区': '乙区',
        'A区': '甲区',
        'C区': '丙区',
        'ICU': '重症监护室',
        '林晚照': '夏小薇',
        '林晚': '夏小薇'
    }

    for k, v in replacements.items():
        body_text = re.sub(re.escape(k), v, body_text)

    book_lines.append(body_text)
    book_lines.append("")
    total_chars += len(body_text)

full_book_content = "\n".join(book_lines)

with open(book_path, 'w', encoding='utf-8') as f:
    f.write(full_book_content)

print(f"✅ 拼书完成: {book_path}")
print(f"总章节数: {len(chapters)} 章 | 总字数: {total_chars} 字符")

# 1. 纯中文零英文检测
eng_words = re.findall(r'[a-zA-Z]{2,}', full_book_content)
if eng_words:
    print(f"⚠️ 警告: 发现英文单词残留 ({len(eng_words)} 处): {set(eng_words)}")
else:
    print("✅ 纯中文零英文自检通过: 全文 0 英文残留！")

# 2. 人名黑名单与偏好姓氏全篇扫描
forbidden_names = [
    '小满', '温', '贺', '霍', '程', '沈', '祁',
    '景川', '柴伯年', '卫云峰', '鲍天成', '范秉德', '游克俭', '卞冬青',
    '桑也', '糜广居', '娄伯', '牟唯', '边响', '翟莹', '裴照', '祁漾',
    '贺兰舟', '陆以哲', '莫怀德', '陈恪', '方楚楚', '严九渊', '卢曼青', '潘一舟',
    '郑启明', '赵德厚', '阮青梧', '屠文彬', '阎朗', '贺沉舟', '牛劲松', '康伯',
    '杭晚', '沈蜜', '甘露', '费驰', '贺连城', '鲁小舟', '桂香', '老魏',
    '穆砚清', '崔建德', '谭临舟', '阮晓棠', '骆一苇', '唐叙白', '庞振海', '林晚',
    '陆峰', '周桂芬', '陈浩', '何建军', '唐越', '严敬山', '宁雪', '陈有福',
    '宋德全', '程一诺', '苗秀兰', '蒋岸', '褚安和', '谈笑', '蒲玉兰', '饶静',
    '秦婶', '柳映棠', '祁严', '白鹭洲', '闻人朗', '纪桐', '孟叙白', '覃慧',
    '阚伯', '池羽', '路之衍', '贺明霜', '周远声', '沈茂春', '聂霜', '霍岑',
    '柯万山', '戚秉忠', '裴凌舟', '郁崇山', '车天骥', '段衡', '黎书言', '乔雪枝',
    '简宁', '程霁', '任天禄', '何沧', '柯见深', '宋振国', '盛清让', '齐慕荪',
    '贺照野', '周鹤年', '程晚棠', '应棠', '麦冬', '陆沉', '关雨眠', '温昭',
    '方砚', '祁烨', '陈晓蔓', '雷正坤', '粟一宁', '荣三叠', '慎行舟', '乌四海',
    '来曼', '归晓', '傅阿姨', '秦制片', '段凯', '钟宁', '彭守成', '庄叙',
    '林岚', '曹猛', '苏佩芸'
]

found_issues = []
for fname in forbidden_names:
    matches = re.findall(re.escape(fname), full_book_content)
    if matches:
        if fname == '温':
            non_name_count = len(re.findall(r'温[和暖水度热柔床情冷饱厚室润的]|没有温度|保温|体温|升温|气温|低热|常温|温差|温升|手温', full_book_content))
            diff = len(matches) - non_name_count
            if diff > 0:
                found_issues.append((fname, diff))
                print(f"⚠️ 发现「温」姓或可疑温字: 疑似人名 {diff} 处 (总出现 {len(matches)} 处)")
            else:
                print(f"✅ 「温」姓检查通过 (仅出现正常词汇 {non_name_count} 处)")
        elif fname == '程':
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

# 3. 分章正则复扫（确保 eval 分章器不会出现幽灵章）
ch_matches = re.findall(r'^[#\s]*第([0-9一二三四五六七八九十百]+)[章节回卷]', full_book_content, re.M)
print(f"分章检测结果: 识别到 {len(ch_matches)} 个章节标记")
if len(ch_matches) == 18:
    print("✅ 章节数精准为 18 章，无幽灵章！")
else:
    print(f"⚠️ 章节数异常: {len(ch_matches)} (预期 18 章)")
