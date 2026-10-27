#!/usr/bin/env python3
import sqlite3
import re
import os

book_path = 'research/daily-novels/2026-10-13-jiu-zhenhongbao/book.md'
db_path = os.getenv('WRITER_DB_PATH', 'data/writer/writer.db')

print(f"=== 开始对 《我开了一瓶两万块的老酒，扫码领到了八块八的真红包》 执行系统级外科手术 ===")

with open(book_path, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. 人名与黑名单替换
print("1. 人名置换...")
text = text.replace('季白', '陈恪')
text = text.replace('小季', '阿恪')
text = text.replace('贺九渊', '严九渊')
text = text.replace('沈曼青', '卢曼青')
text = text.replace('程一苇', '潘一舟')
text = text.replace('程总', '潘总')

# 2. 英文与批次号/版本号清洗
print("2. 英文与字母清洗...")
text = text.replace('T-0417', '特批零四一七')
text = text.replace('V3.2.1', '三点二点一版本')
text = text.replace('Technical', '技术')
text = text.replace('fingerprints', '指纹痕迹')
text = text.replace('half', '一半')

# 拦截可能遗留的单字母或残余
text = re.sub(r'T-(\d+)', r'特批\1', text)
text = re.sub(r'V(\d+)', r'第\1版', text)

# 3. 清除所有（本章完）与脚手架预告
print("3. 清除预告行...")
text = re.sub(r'（(?:第[0-9一二三四五六七八九十百]+章完|本章完)[，、\s\n]*）', '', text)
text = re.sub(r'\(本章完\)', '', text)
text = re.sub(r'（本章完）', '', text)

# 4. 第18章结尾开放式续集钩切除与双落点重构
print("4. 第18章终局闭环与正向实体落点重构...")

old_ch18_ending_pattern = re.compile(
    r'下午宣判前的最后陈述.*',
    re.DOTALL
)

new_ch18_ending = """下午宣判，法槌落下，清脆如磐石落地：

审判长宣读终审判决：楚宏山、严九渊犯生产、销售有毒有害食品罪，伪造国家机关与企业印章罪，数罪并罚，分别判处无期徒刑与有期徒刑二十年；魏宗海、卢曼青、潘一舟依各自非法经营、提供关键技术包材及帮助情节，分别判处八至十五年有期徒刑，并处巨额财产罚金；全案查扣涉案假冒名酒与高仿包材数千箱，由执法机关依法无公害集中销毁；涉案公职人员违纪违法充当保护伞问题，由纪检监察机关依法通报严肃查处，绝不姑息；经侦支队与反洗钱监管部门同步协同，彻底冻结查封境内外关联空壳洗钱资金链。

旁听席上掌声雷动，经久不息。

走出法院大门，江风浩荡，江雾已彻底散尽。

三个月来第一次，秋日的阳光明澈高远，洒满沧陵市的大街小巷，瓦青水碧，天地澄澈。

次日清晨，九渊酒业百年老窖池前。

青石板被晨露洗得发亮，空气中弥漫着纯正浓郁的高粱发酵醇香。封存了整整三年的纯粮原酿老酒坛上，红绸扎得工工整整。

失明已久的师父莫怀德，在陆以哲与陈恪的搀扶下，一步一步稳稳走到老窖池边。老人满是老茧的手抚过泥封的坛口，闭上眼睛，深深吸了一口气，苍老的面庞上终于浮现出释然与宁静的微笑。

“以哲，阿恪。”莫怀德声音有些发颤，却透着前所未有的安稳与厚重，“拍泥吧。正道酿出的好酒，合该见这人间天光。”

陆以哲与陈恪相视一笑，握紧锤木，同时落下。

泥封应声而裂。

清洌馥郁的粮香瞬间在晨风中舒展弥漫，没有一丝刺鼻的工业勾兑气，没有微孔漂移的破绽，只有粮食与岁月沉淀出的纯粹与坦荡。那是两代匠人用命守住的清白，也是他们留给这人间舌尖的底线。

“方记者，快趁热端过来！”

不远处的大槐树下，方楚楚笑着掀开保温大锅，刚熬出锅的红焖羊肉汤咕嘟咕嘟冒着热气，翠绿葱花翻滚，香气扑鼻。

几张老竹椅，一盆滚烫的热羊肉汤，三只粗瓷海碗。

陆以哲给师父、陈恪和自己各满上一碗刚起出来的纯粮新酒。阳光穿过老槐树的枝叶，洒在青石板上，洒在升腾的热汽间。

“师父，敬公道，敬明天。”

三只海碗在晨光里轻轻一碰，发出清脆的回响。

酒入喉，热汤落胃，暖意顺着胸膛直达心底。这世上的雾总会散去，只要守得住良心，每一滴酒，都当得起这人间烟火。"""

if old_ch18_ending_pattern.search(text):
    text = old_ch18_ending_pattern.sub(new_ch18_ending, text)
    print("✅ 终局外科手术成功替换！")
else:
    print("⚠️ 未匹配到第18章结尾 pattern，请检查原文")

# 检查纯中文 0 英文
en_matches = re.findall(r'[A-Za-z]+', text)
print(f"清洗后英文字符数: {len(en_matches)} -> {set(en_matches)}")

# 写回 book.md
with open(book_path, 'w', encoding='utf-8') as f:
    f.write(text)

print(f"✅ book.md 已成功更新写入！")

# 5. 同步回 writer.db 数据库中的 chapter_revision
print("5. 正在同步回 writer.db 数据库...")
try:
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    # 查找项目
    cur.execute("SELECT id FROM project WHERE title = '我开了一瓶两万块的老酒，扫码领到了八块八的真红包' ORDER BY created_at DESC LIMIT 1")
    row = cur.fetchone()
    if row:
        project_id = row[0]
        # 读取各个章节内容并更新
        # 按照 # 第X章 分割
        chap_blocks = re.split(r'# 第\d+章\s+[^\n]+\n', text)
        # 第一块通常为空或前言
        real_chaps = chap_blocks[1:]
        print(f"拆分得到 {len(real_chaps)} 个章节正文")

        # 查询 chapter 和 active_revision
        cur.execute("""
            SELECT c.id, c.active_revision_id, co.position
            FROM chapter c
            JOIN chapter_outline co ON c.outline_id = co.id
            WHERE c.project_id = ?
            ORDER BY co.position ASC
        """, (project_id,))
        db_chaps = cur.fetchall()

        if len(real_chaps) == len(db_chaps):
            for i, (cid, rev_id, pos) in enumerate(db_chaps):
                chap_content = real_chaps[i].strip()
                cur.execute("UPDATE chapter_revision SET content = ?, word_count = ? WHERE id = ?", (chap_content, len(chap_content), rev_id))
            conn.commit()
            print("✅ writer.db 18 个章节已全量同步更新！")
        else:
            print(f"⚠️ 章节数量不一致: 文本 {len(real_chaps)} vs 数据库 {len(db_chaps)}")
    conn.close()
except Exception as e:
    print(f"⚠️ 数据库同步异常: {e}")

print("=== 外科手术与自检全部完成 ===")
