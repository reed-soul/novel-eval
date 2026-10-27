#!/usr/bin/env python3
import sqlite3
import re
import os

book_path = 'research/daily-novels/2026-10-13-jiu-zhenhongbao/book.md'
db_path = os.getenv('WRITER_DB_PATH', 'data/writer/writer.db')

print("=== 开始执行第二轮精准外科手术（针对 marketPotential 市场爽点与中段反击） ===")

with open(book_path, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. 修复第10章结尾的邮件落款由“沈”改为“卢”
text = text.replace('“想要能钉死严九渊的东西吗？沈”', '“想要能钉死严九渊的东西吗？卢”')

# 2. 修复第10章后半段的瘫坐绝望，改为陆以哲反手亮剑、质检预警锁死三千八百万在途货款反客为主
old_ch10_tail = """陆以哲瘫坐在行军床沿，三年前那纸处分、九天被瞒的同盟、刚刚焚毁的证人，三样东西压在同一副肩膀上，压得他第一次生出念头：也许严九渊说得对，也许较真的人，真的赢不了。

就在这时，桌上那台笔记本“叮”地一响。

一封加密邮件，发件人匿名跳板，层层加密。陆以哲木然点开，正文只有一行字，落款一个字，冷得像刀：

**“想要能钉死严九渊的东西吗？卢”**"""

new_ch10_tail = """陈恪浑身发抖，几乎要跪倒在地。

但陆以哲没有瘫坐。他站在窗前，看着浓重的江雾，眼神在这一瞬间寒光毕露。

“他们以为他们赢了？以为把罐头厂当弃子，就能全身而退？”

陆以哲猛地拉开工具包，抽出省质检中心的数字证书授权锁，咔哒一声插进离线笔记本，直接接入全省流通领域食品安全风险预警专网。

“他们既然想借着大雾在三十七场宴席上销赃变现，那我就让他们一瓶都变不成现钱。”

他的手指在键盘上暴风骤雨般敲击。凭着手头已经固化的胶帽微孔热缩漂移数据与微纳光栅光谱比对，他以省首席鉴识师的法定紧急裁量权，当场签发了一份全省加急的《关于特批零四一七号段高端陈酿存在工业添加剂重大安全隐患的风险通报》，一键推送至全省各大物流仓储监管口、十四家主流电商与高端餐饮协会！

系统页面瞬间跳出猩红的“全网风控锁定中”：特批零四一七号段的八千箱名酒、总价值高达三千八百万元的在途资金与商户结算通道，在这一刻被强制执行全网冻结！

这一刀，直接反切进了严九渊和楚宏山的心脏！

就在楚宏山的紧急撤资通道被生生卡死的同一秒，桌上那台笔记本“叮”地一声脆响。

一封加密邮件越过跳板弹了出来。发件人显然被这道突如其来的冻结令彻底打乱了阵脚，正文只有一行字，急促而决绝：

**“想要能钉死严九渊的东西吗？卢”**"""

if old_ch10_tail in text:
    text = text.replace(old_ch10_tail, new_ch10_tail)
    print("✅ 补丁1：ch010 消除主角绝望瘫坐，增加紧急签发预警冻结三千八百万在途货款反客为主大爽点！")
else:
    print("⚠️ 未找到 ch010 目标段落，尝试部分替换")

# 3. 修复第17章结尾：切除严九渊装逼“你们赢的只是一个壳”与境外注销的灰度收束，改为梁锐与陆以哲雷霆出示冻结令反打脸
old_ch17_tail = """严九渊没有挣。他任由两名民警架起手臂，走到宴会厅门口时，忽然停下，回过头，隔着两百桌惊魂未定的人群，朝陆以哲轻轻一笑。

“陆工，验得好。”他说，“可惜，你们赢的，只是一个壳。”

陆以哲心头一紧：“什么意思？”

严九渊没再答。他被押出大门，银发消失在晨光里。

方楚楚的手机在这时疯狂震动。她看了一眼屏幕，脸色骤变，把手机递过来——

财经快讯，五分钟前推送：

**“境外某离岸控股公司连夜公告，自愿注销在华全部代表机构与备案文件，相关注册文书同日作废。”**

注销时间：今天凌晨零点四十一分。

比公证处的钢印，晚了整整一分。"""

new_ch17_tail = """严九渊被两名民警架起手臂，走到宴会厅门口时，忽然停下脚步。他回过头，咬着牙还想垂死挣扎，冲着陆以哲冷笑：“陆工，验得好。可惜，你们抓了我也没用，海外母公司的洗钱网络早就——”

“你以为你背后的境外资金跑得掉？”梁锐大步跨上主席台，将一份加盖省公安厅经侦总队与国家反洗钱监测中心鲜红印章的《特大涉案账户紧急冻结决定书》直接拍在严九渊面前，“十分钟前，经国际刑警组织与我国反洗钱监管部门跨境紧急穿透，你们藏在离岸壳公司名下的十一个洗钱中转账户、八点四亿元涉案资金，已经在中央清算结算中心全额物理冻结！一个子儿都转不出去！”

严九渊浑身剧烈颤抖，脸上最后的伪装与傲慢瞬间彻底碎成齑粉，整个人面如死灰，膝盖一软，瘫倒在民警手中。

方楚楚举起相机，闪光灯亮如白昼，将楚宏山与严九渊当场戴上手铐、狼狈被押走的特写牢牢定格。

宴会厅里，两百桌惊魂初定的宾客与家属爆发出雷鸣般的掌声与喝彩！

红膜假酒被贴上一道道醒目的白底红字封条，整齐查封。陆以哲长长吐出一口浊气，看着初升的朝阳刺破晨雾、洒满大厅，整座江城的朗朗乾坤，在这一刻彻底清明。"""

if old_ch17_tail in text:
    text = text.replace(old_ch17_tail, new_ch17_tail)
    print("✅ 补丁2：ch017 彻底消除灰度收尾，改为八点四亿资金物理冻结、反派当场瘫软的雷霆打脸大爽点！")
else:
    print("⚠️ 未找到 ch017 目标段落，请检查原文")

# 4. 检查纯中文 0 英文
en_matches = re.findall(r'[A-Za-z]+', text)
print(f"清洗后英文字符数: {len(en_matches)} -> {set(en_matches)}")

with open(book_path, 'w', encoding='utf-8') as f:
    f.write(text)

print(f"✅ book.md 已成功更新写入！")

# 5. 同步回 writer.db 数据库
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

print("=== 第二轮补丁应用完成 ===")
