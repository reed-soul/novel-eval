#!/usr/bin/env python3
import sqlite3
import re
import os
import sys

db_path = os.getenv('WRITER_DB_PATH', 'data/writer/writer.db')
target_title = '我给查封老宅做产权核验，档案里的原房主死后第三年签了字'
output_dir = 'research/daily-novels/2026-10-07-laozhai-chanquan'

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
    if clean_title == 'B区冷藏车':
        clean_title = '乙区冷藏车'
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

        if any(leak in s for leak in ['待续路径提示', '【写作蓝图】', '【大纲草稿】', '【本章小结】', '下章预告']):
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

    # 应用清洗规则
    body_text = body_text.replace('invisible', '难以察觉')
    body_text = body_text.replace('ceiling', '天花板')
    body_text = body_text.replace('currently', '当前正被')
    body_text = body_text.replace('B区', '乙区')
    body_text = body_text.replace('第一章到今天，他被拨快了十七分。', '从最初接手到今天，他被拨快了十七分。')

    # 应用外科手术
    if pos == 3:
        old_ch3_target = """“那就让纸来掰。”晏修远说，“纸比我硬。”

庞振海起身，掸了掸西装上并不存在的灰：“那就可惜了。”"""
        new_ch3_target = """“那就让纸来掰。”晏修远平静地拉开办公桌抽屉，取出一张刚刚由司法鉴定行业协同平台打印出的《抵押公证书防伪编码预警通报》，推到庞振海眼前。

“庞顾问，不用等以后掰。你刚进门递过来的那张名片，正信商事咨询调查所，统一社会信用代码尾号七一九。十分钟前，经侦和登记中心专网已经对你们送审的所有抵押权属申请启动了反向交叉核验。这份由你们代办的梧桐里抵押合同附录公证书，流水号第三位和第八位缺了公证防伪暗码，系统判定‘疑似虚假公文’，已被前台一键冻结并自动直报市经侦二大队。你手里的这六个零，还是留着给你自己请辩护律师吧。”

庞振海脸上的笑终于彻底僵死，眼角肌肉狠狠抽搐了一下，手猛地一抖，连名片夹都掉在地上。他死死盯着那张盖着公章的冻结预警通报，嘴唇泛白，半晌没说出一个字，最后狼狈抓起牛皮纸袋摔门而去。

“纸比我硬。”晏修远对着空荡荡的门口低声说。"""
        if old_ch3_target in body_text:
            body_text = body_text.replace(old_ch3_target, new_ch3_target)

    if pos == 8:
        old_ch8_target = """傍晚六点半，他从那栋灰楼里走出来，西装还笔挺，脸色却灰得像纸。他对着镜头一言不发，钻进车里。"""
        new_ch8_target = """傍晚六点半，他从那栋灰楼里走出来，西装还笔挺，脸色却灰得像纸。

与此同时，市不动产登记大厅电子大屏上，一条加粗红字公告悄然刷新：《关于对梧桐里四十八号等案涉资产启动权属异议查扣程序的通报》。大厅内，曾经指着晏修远鼻子叫嚣的几名涉案中间人当场被赶来的法警与经侦民警依法出具限制令控制。平日里冷眼旁观晏修远坐冷板凳的窗口同事们纷纷起立，目光齐刷刷投向档案科那间亮着灯的办公室，不知道是谁先带头，大厅里响起了压抑已久的掌声。

庞振海对着镜头一言不发，在众人的指指点点下仓皇钻进车里。"""
        if old_ch8_target in body_text:
            body_text = body_text.replace(old_ch8_target, new_ch8_target)

    if pos == 18:
        old_ch18_target = """通报在报纸角落一笔带过：涉案团伙十九人到案，假证黑产网络全链条覆灭，相关公职人员依法处理，三百一十七户产权启动逐一更正，梧桐里五十号冯家老人的下落已循转运线索追查，老人活着，找到了。"""
        new_ch18_target = """官方通报在报纸与政务网置顶发布：市纪检监察机关依法查处房产登记管理系统个别公职人员滥用职权、为黑产违规开辟通道充当保护伞问题，涉案人员已被开除公职并移送检察机关审查起诉；涉案假证与侵占资产团伙十九人全部落网移送起诉，正信商事咨询所被依法取缔，庞振海、左秉成等主犯数罪并罚；三百一十七户被侵占房屋权属更正工作全面启动，梧桐里五十号冯家老人的下落已循转运线索查清解救，老人活着，安然无恙。"""
        if old_ch18_target in body_text:
            body_text = body_text.replace(old_ch18_target, new_ch18_target)

        old_hook = """“名单上那三百一十七户……我以为我算清了每一个刻度。”

晏修远隔着玻璃看他，缓缓开口：

“你母亲当年的学生里，还有一个活着的，名字，你没查到。”

左秉成的瞳孔骤然收缩。

（本章完）"""
        new_hook = """“名单上那三百一十七户……我以为我算清了每一个刻度。”左秉成将额头贴在冰冷的玻璃上，低声喃喃，“可我最后还是算漏了时间……算漏了人心。”

晏修远隔着玻璃看着他，平静地站起身：“时间从来不需要被算计。它只需要被记录，被记住，被守住。”

他转身离开会见室。

阳光透过看守所厚重的铁门洒满长阶。街角梧桐树影摇曳，梧桐里四十八号的小院里，正午十二点的钟声清脆悠扬地穿透了整个街区，钟摆不疾不徐，一秒，一秒，坚定地向前迈去。那是生活重新开始的声音。

（全书完）"""
        if old_hook in body_text:
            body_text = body_text.replace(old_hook, new_hook)

    # 同步回数据库
    c.execute("UPDATE chapter_revision SET content = ?, word_count = ? WHERE id = ?", (body_text, len(body_text), rev_id))

    book_lines.append(body_text)
    book_lines.append("")
    total_chars += len(body_text)

conn.commit()
conn.close()

full_book = "\n".join(book_lines)
with open(book_path, 'w', encoding='utf-8') as f:
    f.write(full_book)

print(f"\n✅ 拼书与数据库同步完成：{book_path}")
print(f"总字数（正文字符数）: {total_chars} 字 | 章节数: {len(chapters)} 章")

# --- 严格质量自检 ---
print("\n--- 开始文本合规与质量自检 ---")

# 1. 英文残留
en_matches = re.findall(r'[A-Za-z]', full_book)
if en_matches:
    print(f"❌ 发现英文字符残留 ({len(en_matches)} 处): {set(en_matches)}")
else:
    print("✅ 纯中文零英文残留: 通过 (0 处英文字符)")

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
    '沈停云', '戚秉忠', '戚秉中', '齐烈', '巴延海', '岳小刀', '贺连城', '池小禾', '祝明川', '顾则鸣', '裴真', '阎克敬',
    '裴凌舟', '程霁', '白鹭洲', '祁严', '郁崇山', '车天骥', '黎书言', '段衡', '莫秉钧', '何沧', '乔雪枝', '任天禄', '魏承峰', '毕成业', '柯见深', '陆嘉禾', '简宁', '许衡', '方靖', '沈雪梅'
]

hits = 0
for name in blacklist:
    cnt = len(re.findall(re.escape(name), full_book))
    if cnt > 0:
        print(f"❌ 命中黑名单禁名: '{name}' 出现 {cnt} 次")
        hits += 1

# 检查温姓角色
wen_matches = re.findall(r'温[一-龥]{1,2}(?=[，。！？\s说走了道])', full_book)
safe_words = ['温度', '温控', '温水', '体温', '温热', '恒温', '温润', '温暖', '升温', '降温', '保温', '炉温', '气温', '温桶', '温杯', '温箱', '温和']
illegal_wen = [w for w in wen_matches if not any(w.startswith(sw) or sw in w for sw in safe_words)]
if illegal_wen:
    print(f"❌ 发现可能违禁的温姓人名: {list(set(illegal_wen))}")
    hits += 1

# 检查霍姓角色
huo_matches = re.findall(r'霍[一-龥]{1,2}(?=[，。！？\s说走了道])', full_book)
if huo_matches:
    print(f"❌ 发现可能违禁的霍姓人名: {list(set(huo_matches))}")
    hits += 1

if hits == 0:
    print("✅ 人名合规自检通过: 无「小满」、无「温」姓角色、无「霍」姓角色、无近 10 部历史人物撞名")

print("--- 自检完毕 ---")
