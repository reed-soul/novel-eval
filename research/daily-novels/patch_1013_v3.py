#!/usr/bin/env python3
import sqlite3
import re
import os

book_path = 'research/daily-novels/2026-10-13-jiu-zhenhongbao/book.md'
db_path = os.getenv('WRITER_DB_PATH', 'data/writer/writer.db')

print("=== 开始执行第三轮精准外科手术（针对 audit 双红队 P0 逻辑闭环） ===")

with open(book_path, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. 修复第18章判决：补齐郑启明与保护伞赵德厚的实质判决（解决 B 跑 P0-6）
old_ch18_sentence = """审判长宣读终审判决：楚宏山、严九渊犯生产、销售有毒有害食品罪，伪造国家机关与企业印章罪，数罪并罚，分别判处无期徒刑与有期徒刑二十年；魏宗海、卢曼青、潘一舟依各自非法经营、提供关键技术包材及帮助情节，分别判处八至十五年有期徒刑，并处巨额财产罚金；全案查扣涉案假冒名酒与高仿包材数千箱，由执法机关依法无公害集中销毁；涉案公职人员违纪违法充当保护伞问题，由纪检监察机关依法通报严肃查处，绝不姑息；经侦支队与反洗钱监管部门同步协同，彻底冻结查封境内外关联空壳洗钱资金链。"""

new_ch18_sentence = """审判长宣读终审判决：楚宏山、严九渊犯生产、销售有毒有害食品罪，伪造国家机关与企业印章罪，数罪并罚，分别判处无期徒刑与有期徒刑二十年；境外母公司名义法人郑启明在国际刑警组织红色通报协作下于口岸落网归案，判处有期徒刑十八年；原质检中心处分签发人、现宏山顾问赵德厚充当黑产保护伞并收受巨额贿赂，由市纪委监委立案审查调查、开除党籍公职并移送起诉，判处有期徒刑十二年；魏宗海、卢曼青、潘一舟依各自非法经营、提供关键技术包材及帮助情节，分别判处八至十五年有期徒刑，并处巨额财产罚金；全案查扣涉案假冒名酒与高仿包材数千箱，由执法机关依法无公害集中销毁；经侦支队与国家反洗钱监测中心协同穿透，彻底冻结查封境内外关联空壳洗钱资金链。"""

if old_ch18_sentence in text:
    text = text.replace(old_ch18_sentence, new_ch18_sentence)
    print("✅ 补丁1：ch018 判决补齐郑启明十八年有期徒刑、保护伞赵德厚十二年有期徒刑闭环！")
else:
    print("⚠️ 未找到 ch018 目标判决段落")

# 2. 修复第11章：补齐卢曼青分账现场录音使能（珍珠胸针微型录音探头，解决 B 跑 P0-1）
old_ch11_rec = """红旗罐头厂的投产流水、还有——严九渊本人三次出现在分账现场的录音。他以为自己烧掉了所有纸面的东西，可钱走过的路，烧不掉。这本账在我手里，能从他钉死我，变成我钉死他。”"""

new_ch11_rec = """红旗罐头厂的投产流水、还有——严九渊本人三次出现在分账现场的录音。我每次去顶层暗室分账，都在珍珠胸针里藏了微型录音探头，三年里每一次严九渊露面分账，我都录得清清楚楚作为保命符，连同原始录音介质一同锁在银行独立保险柜。他以为自己烧掉了所有纸面的东西，可钱走过的路、人说过的话，烧不掉。这本账在我手里，能从他钉死我，变成我钉死他。”"""

if old_ch11_rec in text:
    text = text.replace(old_ch11_rec, new_ch11_rec)
    print("✅ 补丁2：ch011 补齐卢曼青分账录音来源（珍珠胸针微型探头+银行保险箱存证）！")
else:
    print("⚠️ 未找到 ch011 目标录音段落")

# 3. 修复第16章：呼叫转移日志公证存活机制与同卡池密码学唯一排他证明（解决 A 跑 P0-2, P0-3）
old_ch16_log = """他把号码的呼叫转移记录调出来。境外转售商的底层日志，三个月前暗桩激活时，他顺手抓过一份缓存，一直没用上。

缓存里，这个号码的呼叫转移目标，赫然是另一个境外号码。两个号码，同一张转售商的卡池，同一秒开通。

第二个号码，注册人字段没有名字，只有一个公司编号。"""

new_ch16_log = """他把号码的呼叫转移记录调出来。这份转售商底层通信日志，是陈恪三个月前通过转售商对外接口同步、并第一时间通过公证处电子存证平台固化加盖只读时间戳的原始镜像，存活于独立物理冷盘中，哪怕境外机房格式化也绝无法抹去。

镜像里，这个号码的呼叫转移目标，赫然是另一个境外号码。两个号码在转售商卡池里由后台同一脚本批量触发，同卡池、同秒开通、同企业组织代码。在密码学与通信工程上，这种批量并发具有绝对的唯一排他性，彻底封死了任何巧合或伪造的可能。

第二个号码，注册人字段没有名字，只有一个公司编号。"""

if old_ch16_log in text:
    text = text.replace(old_ch16_log, new_ch16_log)
    print("✅ 补丁3：ch016 补齐呼叫转移公证冷盘存活机制与卡池唯一排他性证明！")
else:
    print("⚠️ 未找到 ch016 目标呼叫转移段落")

# 4. 修复第5章：三十七场宴席不提前打草惊蛇的合法性与前置预警备案（解决 A 跑 P0-6）
old_ch5_leak = """“打通往支队的那条线，比打通酒厂的密钥还难。”陈恪合上电脑，“打草惊蛇只有一个结果：罐头厂连夜清场，借着江雾季换地方。雾还有十四天起。雾起之日，产线搬走，特批零四一七开席。到那时，你在哪座城市都找不到一个灌装头。”"""

new_ch5_leak = """“打通往支队的那条线，比打通酒厂的密钥还难。”陈恪合上电脑，“更重要的是，这三十七场婚宴用酒全部采取‘婚礼当日专车统一配送、开席前锁入酒店地库专属保险库’的封闭仓配链，目前终端酒店尚未接货，现在贸然冲进一家酒店不仅查不到实物毒酒，反而会打草惊蛇——罐头厂会连夜清场，借着江雾季换地方。方楚楚已经通过省报向省食品药品稽查总队实名递交了特急《假酒流向风险预警内参》，并在各酒店锁定了暗访哨位。我们的目标是在开席前一小时，人赃并获全城雷霆收网！否则雾起之日，产线搬走，特批零四一七散入千家万户，你在哪座城市都找不到一个灌装头。”"""

if old_ch5_leak in text:
    text = text.replace(old_ch5_leak, new_ch5_leak)
    print("✅ 补丁4：ch005 补齐三十七场宴席前置内参报备与打草惊蛇逻辑闭环！")
else:
    print("⚠️ 未找到 ch005 目标段落")

# 检查纯中文 0 英文
en_matches = re.findall(r'[A-Za-z]+', text)
print(f"清洗后英文字符数: {len(en_matches)} -> {set(en_matches)}")

with open(book_path, 'w', encoding='utf-8') as f:
    f.write(text)

print("✅ book.md 已成功更新写入！")

# 同步回 writer.db
print("正在同步更新回 writer.db 数据库...")
try:
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT id FROM project WHERE title = '我开了一瓶两万块的老酒，扫码领到了八块八的真红包' ORDER BY created_at DESC LIMIT 1")
    row = cur.fetchone()
    if row:
        project_id = row[0]
        chap_blocks = re.split(r'# 第\d+章\s+[^\n]+\n', text)
        real_chaps = chap_blocks[1:]

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
    conn.close()
except Exception as e:
    print(f"⚠️ 数据库同步异常: {e}")

print("=== 第三轮补丁全部完成 ===")
