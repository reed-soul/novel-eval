#!/usr/bin/env python3
import sqlite3
import re

db_path = "data/writer/writer.db"
project_id = "2cafa4f2-64ff-43b3-bda7-d073be02a679"

conn = sqlite3.connect(db_path)
c = conn.cursor()

print("=== 开始执行 patch_1015 外科手术修复 ===")

# 1. 修复第 4 章脚手架泄漏与标题
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
    # 切除脚手架说明和前面的假标题
    new_content = re.sub(r'^#\s*第4章\s*击穿陆则铭的名单\s*\n+.*?(?=#\s*第4章\s*击穿灰色平台负责人的名单)', '', content, flags=re.DOTALL)
    # 再次清理可能残留的修正说明
    new_content = re.sub(r'#\s*第4章\s*击穿灰色平台负责人的名单\s*\n*', '', new_content).strip()
    new_title = "击穿灰色平台负责人的名单"
    c.execute("UPDATE chapter_revision SET title = ?, content = ? WHERE id = ?", (new_title, new_content, rev_id))
    # 同步更新 outline revision
    c.execute("""
    UPDATE chapter_outline_revision SET title = ?
    WHERE id = (
        SELECT co.active_revision_id FROM chapter c
        JOIN chapter_outline co ON c.outline_id = co.id
        WHERE c.project_id = ? AND co.position = 4
    )
    """, (new_title, project_id))
    print(f"✅ 第 4 章脚手架切除完毕，标题已更新为: {new_title}")

# 2. 修复第 12 章英文 twenty-five
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
    new_content = content.replace("twenty-five", "二十五")
    c.execute("UPDATE chapter_revision SET content = ? WHERE id = ?", (new_content, rev_id))
    print("✅ 第 12 章 twenty-five 修复完毕")

# 3. 修复第 16 章英文 dormant 与 clone
c.execute("""
SELECT cr.id, cr.content
FROM chapter c
JOIN chapter_outline co ON c.outline_id = co.id
JOIN chapter_revision cr ON c.active_revision_id = cr.id
WHERE c.project_id = ? AND co.position = 16
""", (project_id,))
row = c.fetchone()
if row:
    rev_id, content = row
    new_content = content.replace("dormant", "休眠").replace("clone", "克隆复制")
    c.execute("UPDATE chapter_revision SET content = ? WHERE id = ?", (new_content, rev_id))
    print("✅ 第 16 章 dormant / clone 修复完毕")

conn.commit()
conn.close()
print("=== 数据库修订保存成功 ===")
