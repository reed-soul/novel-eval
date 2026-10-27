#!/usr/bin/env python3
import sqlite3
import re
import os

db_path = "data/writer/writer.db"
project_id = "b0365b2f-9812-46f6-8b76-9b74b993e96e"

print("=== 开始执行 patch_1017 外科手术修复与数据库同步 ===")
conn = sqlite3.connect(db_path)
c = conn.cursor()

# 查出该项目的所有章节
c.execute("""
SELECT c.id, co.position, cr.id, cr.content
FROM chapter c
JOIN chapter_outline co ON c.outline_id = co.id
JOIN chapter_revision cr ON c.active_revision_id = cr.id
WHERE c.project_id = ?
ORDER BY co.position ASC
""", (project_id,))

rows = c.fetchall()
print(f"查出 {len(rows)} 个章节")

for chap_id, pos, rev_id, content in rows:
    new_content = content

    # 1. 人名与偏好姓氏修复
    new_content = new_content.replace('佟小满', '卞冬青')
    new_content = new_content.replace('小满', '冬青')
    new_content = new_content.replace('沈律师', '卓律师')
    new_content = new_content.replace('沈律', '卓律')
    new_content = new_content.replace('沈父', '卓父')
    new_content = new_content.replace('沈璃', '卓璃')
    new_content = new_content.replace('沈。', '卓。')
    new_content = new_content.replace('芯程通达', '芯拓通达')

    # 2. 英文与混杂词修复
    new_content = new_content.replace('vague 的一个名头', '含糊其辞的一个名头')
    new_content = new_content.replace('vague', '含糊其辞')
    new_content = new_content.replace('oxidized', '氧化')
    new_content = new_content.replace('ox账号ized', '氧化')
    new_content = new_content.replace('unusually 密', '异常密集')
    new_content = new_content.replace('unusually', '异常')
    new_content = new_content.replace('T7H3', '丁七号三型')
    new_content = new_content.replace('T7K1', '丁七号甲型')

    # 3. 终章（第 18 章）开放式续集钩切除与大快人心双落点封闭
    if pos == 18:
        hook_idx = new_content.find('结案卷宗归档当夜，十一点四十七。')
        if hook_idx != -1:
            split_pos = new_content.rfind('---', 0, hook_idx)
            if split_pos != -1:
                before_hook = new_content[:split_pos].strip()
            else:
                before_hook = new_content[:hook_idx].strip()
            ending_clean = """---

结案那天，物证库外。

最后一车查封电池入库，铅封贴好，景川在流转单上签完最后一个名字——这是他以鉴识工程师身份完成的最沉重也最光荣的一次签字。笔尖离开纸面的瞬间，心里那块压了三年的石头，终于稳稳落了地。

范秉德、鲍天成等主犯的起诉书副本已经送达。卓璃整理着卷宗，她说开庭那天她将以原告代理律师身份出庭，为那些在烈日下奔波的骑手，也为了所有被假电池伤害过的普通人。“涉案人员全部追诉到底，资金全额冻结追缴，”她说，“法庭上见。”

游克俭送景川走出物证库大门，拍了拍他的肩膀：“六个月后复职，首席专家的席位给你留着。”

“留不留无所谓。”景川迎着清晨明亮的天光笑了笑，摸出衣兜里那枚陪伴了师徒两代人三十年的磨损千分尺，“守规矩的家伙什儿在手里，底线就在。”

窗外，滨湖高新区新建的标准智能换电站前，窗明几净，整整齐齐的国标防爆电池包静静亮着安全的绿灯。街角早点铺的热气袅袅升起，豆浆滚烫，包子飘香，生活平稳向前，晨光洒满了整条长街。"""
            new_content = before_hook + "\n\n" + ending_clean
            print("✅ 第 18 章续集钩切除并封闭为双落点实体场景")

    if new_content != content:
        c.execute("UPDATE chapter_revision SET content = ? WHERE id = ?", (new_content, rev_id))
        print(f"✅ 第 {pos} 章内容更新成功")

conn.commit()
conn.close()
print("=== 数据库全部更新完毕 ===")
