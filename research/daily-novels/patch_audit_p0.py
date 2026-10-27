#!/usr/bin/env python3
import sqlite3
import re

db_path = "data/writer/writer.db"
project_id = "2cafa4f2-64ff-43b3-bda7-d073be02a679"

conn = sqlite3.connect(db_path)
c = conn.cursor()

print("=== 正在执行 patch_audit_p0 精确闭环修复 ===")

# --- 1. ch004: 补齐逆向反查使能 ---
c.execute("""
SELECT cr.id, cr.content
FROM chapter c
JOIN chapter_outline co ON c.outline_id = co.id
JOIN chapter_revision cr ON c.active_revision_id = cr.id
WHERE c.project_id = ? AND co.position = 4
""", (project_id,))
row = c.fetchone()
if row:
    rev_id, content = row
    old_c4 = "清晨八点二十，钟宁把那行【该等级账号当前持有人：彭守成】盯了整整十秒，然后合上了屏幕。"
    new_c4 = "清晨八点二十，钟宁坐在工位前，看着自己耗费整夜顺着异常卡池底层根证书逆向反查出的管理员身份映射——那行【该等级账号当前持有人：彭守成】，在屏幕上冰冷地亮着。她盯了整整十秒，然后合上了屏幕。"
    if old_c4 in content:
        content = content.replace(old_c4, new_c4)
    c.execute("UPDATE chapter_revision SET content = ? WHERE id = ?", (content, rev_id))
    print("✅ ch004 根证书反查使能前置完成")

# --- 2. ch017: 恢复倒计时悬念钩，移除错位的提前交锋 ---
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
    # 将 ch017 恢复到七点五十一分倒计时九分钟的悬念章尾
    content = re.sub(r'就在清算倒计时只剩最后六十秒时.*', '', content, flags=re.DOTALL).strip()
    c.execute("UPDATE chapter_revision SET content = ? WHERE id = ?", (content, rev_id))
    print("✅ ch017 恢复标准倒计时高潮悬念位")

# --- 3. ch018: 将水头正面交锋置于终局四十七秒落闸时刻，补齐学费清白定性与听证会因果 ---
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
    
    # 1. 在四十七秒落闸瞬间加入水头气急败坏电话交锋
    target_pos = "新系统生效第一毫秒，全网闸门整齐闭合。"
    faceoff_text = """新系统生效第一毫秒，全网闸门整齐闭合。

就在闸门锁死的瞬间，总控台的红色应急专线疯狂尖叫起来。钟宁按下免提，扬声器里传来水头气急败坏、撕心裂肺的暴怒：

“钟宁！立刻解除端口拦截！八千万在迁移通道被锁死，你知道得罪的是谁吗？！”

钟宁站在主控屏前，看着全屏归零的绿色确认回执，声音冷如寒铁：

“水头，你的八个跨省卡池、两千三百个虚拟中继商户已被全部冻结。经侦的警车已经到了你的楼下。八千万受害者的血汗钱，你一分都别想带走。”

咔嚓一声，她利落地切断了线路。"""

    if target_pos in content:
        content = content.replace(target_pos, faceoff_text)
    
    # 2. 闭环学费资金合法性审查
    old_audit = "“我漏放过一笔。”她说，“但同一天我拦下了一百笔"
    new_audit = """“经市经侦支队与审计专案组严密穿透核查，当年彭守成资助我的每一笔学费与助学款，均来自他早年合法的职务薪酬与正规专利转让费，未沾染分毫涉案资金。但这绝不是我逃避复盘的借口。

“我漏放过一笔。”她说，“但同一天我拦下了一百笔"""
    if old_audit in content:
        content = content.replace(old_audit, new_audit)

    # 3. 补齐听证会的前置因果交代
    old_hearing = "钟宁自己，在案件听证会上做了一件所有人都劝她别做的事。"
    new_hearing = """全案资产追缴冻结完毕的第三周，集团风控委员会与行业监管协调办联合召开了全员责任复盘与从业资质听证会。

钟宁自己，在案件听证会上做了一件所有人都劝她别做的事。"""
    if old_hearing in content:
        content = content.replace(old_hearing, new_hearing)

    c.execute("UPDATE chapter_revision SET content = ? WHERE id = ?", (content, rev_id))
    print("✅ ch018 终局落闸交锋、学费合法性与听证会因果闭环完成")

conn.commit()
conn.close()
print("=== patch_audit_p0 修订全部生效 ===")
