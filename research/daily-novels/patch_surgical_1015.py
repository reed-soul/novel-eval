#!/usr/bin/env python3
import sqlite3
import re

db_path = "data/writer/writer.db"
project_id = "2cafa4f2-64ff-43b3-bda7-d073be02a679"

conn = sqlite3.connect(db_path)
c = conn.cursor()

print("=== 正在执行 patch_surgical_1015 外科手术增强 ===")

# --- 1. ch007: 区分倒计时时间账（72小时 -> 48小时）---
c.execute("""
SELECT cr.id, cr.content
FROM chapter c
JOIN chapter_outline co ON c.outline_id = co.id
JOIN chapter_revision cr ON c.active_revision_id = cr.id
WHERE c.project_id = ? AND co.position = 7
""", (project_id,))
row = c.fetchone()
if row:
    rev_id, content = row
    content = content.replace("七十二小时期限", "四十八小时期限")
    content = content.replace("给你七十二小时", "给你四十八小时")
    c.execute("UPDATE chapter_revision SET content = ? WHERE id = ?", (content, rev_id))
    print("✅ ch007 倒计时期限清晰化完成")

# --- 2. ch012: 天台反转释压，林岚带出经侦重磅战果反杀 ---
c.execute("""
SELECT cr.id, cr.content
FROM chapter c
JOIN chapter_outline co ON c.outline_id = co.id
JOIN chapter_revision cr ON c.active_revision_id = cr.id
WHERE c.project_id = ? AND co.position = 12
""", (project_id,))
row = c.fetchone()
if row:
    rev_id, content = row
    boost_text = """

林岚从大衣口袋里掏出一台亮着绿灯的移动警务终端，屏幕直接推到钟宁眼前。

“别急着把罪名往自己头上扣。”林岚的声音沉着有力，带着一股铁铸的锐气，“你停职前锁死的那一百笔核心异常流水，经侦专案组一分钟都没浪费。就在半小时前，邻省两个隐蔽取现窝点已被我们全部端掉，当场缴获作案手机六十部、银行卡两百余张！顺着你给的数据拓扑，我们已经倒查反向锁定了八个二级洗钱卡池的资金路由！”

钟宁猛地抬起头，夜风吹开额前的乱发，眼中原本灰暗的阴霾被这抹亮光瞬间击穿。

“钟宁，你从不是什么漏网的帮凶，”林岚盯着她的眼睛，字字千钧，“你是经侦这把尖刀最锋利的刃尖。接下来，该我们反击了。”"""
    content = content.strip() + boost_text
    c.execute("UPDATE chapter_revision SET content = ? WHERE id = ?", (content, rev_id))
    print("✅ ch012 天台释压与经侦战果反杀增强完成")

# --- 3. ch015: 提前铺垫庄叙，卧底代点人暗中破局互通数据 ---
c.execute("""
SELECT cr.id, cr.content
FROM chapter c
JOIN chapter_outline co ON c.outline_id = co.id
JOIN chapter_revision cr ON c.active_revision_id = cr.id
WHERE c.project_id = ? AND co.position = 15
""", (project_id,))
row = c.fetchone()
if row:
    rev_id, content = row
    zhuang_text = """

就在这时，钟宁放在草稿纸旁边的私人手机突然震动了一下。

屏幕上亮起一条来自加密频道的陌生短信。短信没有客套，直接附带了一张密密麻麻的手绘逆向数据拓扑图，甚至精准指出了百味坊卡券在各省商户对账清算时的微小延迟漏洞。

短信末尾附着一段话：

“钟稽核员，按你的风控算法，第三层虚拟卡池漏算了一条商户垫付时差。我也在查这批代下单，我叫庄叙，曾是分布式系统架构师。两年前我妹妹被电信诈骗卷走全部积蓄自杀未遂，这帮人用百味坊代点券洗劫了她。我在二手代点群卧底了整整十四个月，群里负责分发订单的一百零八个托，名单我全替你咬死了。八千万元的底账，我们一起把它掀出来。”

钟宁握着手机，指节发白。原来在看不见的深渊里，早就有人和她背靠着背，在同一个战壕里无声搏杀。"""
    content = content.strip() + zhuang_text
    c.execute("UPDATE chapter_revision SET content = ? WHERE id = ?", (content, rev_id))
    print("✅ ch015 庄叙卧底身份与暗中助攻铺垫完成")

# --- 4. ch017: 增加水头气急败坏当面交锋，钟宁当场报指令绝杀 ---
c.execute("""
SELECT cr.id, cr.content
FROM chapter c
JOIN chapter_outline co ON c.outline_id = co.id
JOIN chapter_revision cr ON c.active_revision_id = cr.id
WHERE c.project_id = ? AND co.position = 17
""", (project_id,))
row = c.fetchone()
if row:
    rev_id, content = row
    faceoff_text = """

就在清算倒计时只剩最后六十秒时，总控台的红色加密应急热线突然疯狂尖叫起来。

钟宁按下免提。扬声器里，一直以优雅体面自居的幕后“水头”，此刻彻底撕碎了全部伪装，粗暴的喘息与气急败坏的咆哮震耳欲聋：

“钟宁！立刻解除端口拦截！你知道这批通道背后站着什么人吗？八千万资金一旦过点清算归零，不仅你们集团要倒，你走不出青浔市半步！”

会议室里一片死寂，唯有服务器风扇的怒吼。

钟宁稳稳站在主控屏前，眼神冷静如极地玄冰。她一手按下总清算熔断确认键，一手拿起话筒，声线平静得让对方心惊肉跳：

“水头，你的八个跨省洗钱卡池、两千三百个虚拟中继商户，就在刚刚零点零一秒，全部被中国人民银行清算中心物理锁死。经侦大队的警车已经包围了你的机房。”

“八千万受害者的血汗钱，你一分都别想带走。”

“咔嚓”一声，钟宁直接切断通话，倒计时归零！"""
    content = content.strip() + faceoff_text
    c.execute("UPDATE chapter_revision SET content = ? WHERE id = ?", (content, rev_id))
    print("✅ ch017 水头正面交锋与钟宁当面绝杀打脸完成")

# --- 5. ch018: 闭环岑守义老人债务，情感圆满收束 ---
c.execute("""
SELECT cr.id, cr.content
FROM chapter c
JOIN chapter_outline co ON c.outline_id = co.id
JOIN chapter_revision cr ON c.active_revision_id = cr.id
WHERE c.project_id = ? AND co.position = 18
""", (project_id,))
row = c.fetchone()
if row:
    rev_id, content = row
    repay_text = """

在全案资产追缴与按序返还现场，钟宁亲自找到了岑守义老人的儿子。

红色的全额返还资金到账凭证上，公章鲜红醒目。老人儿子双手颤抖地接过凭证，眼眶通红地朝着钟宁深深鞠了一躬：“我父亲临走前还在问，那笔被骗走的养老钱还能回来吗……钟同志，谢谢你，你替老人家把尊严争回来了。”

那一刻，钟宁胸口压了三年的重石终于彻底粉碎。"""
    
    # 插入在晨光快餐店之前
    if "晨光彻底破开云层" in content:
        content = content.replace("晨光彻底破开云层", repay_text + "\n\n晨光彻底破开云层")
    else:
        content += "\n\n" + repay_text
    c.execute("UPDATE chapter_revision SET content = ? WHERE id = ?", (content, rev_id))
    print("✅ ch018 岑守义情感债务闭环完成")

conn.commit()
conn.close()
print("=== 外科手术增强全部完成并保存至数据库 ===")
