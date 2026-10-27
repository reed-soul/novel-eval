#!/usr/bin/env python3
import sqlite3
import re

db_path = "data/writer/writer.db"
project_id = "2cafa4f2-64ff-43b3-bda7-d073be02a679"

conn = sqlite3.connect(db_path)
c = conn.cursor()

print("=== 开始执行 patch_1015_v2 切除续集钩与优化终章 ===")

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
    
    # 替换结尾：移除续集钩，以大快人心和正向落点实体场景彻底收束
    old_target = """窗外，街角的百味坊快餐店刚出炉的热气腾起来。有个人陪着康复的妹妹坐在窗边，吃着包子，推门而入的风铃响了一声。他抬头，和钟宁隔着玻璃相视一笑。

新人坐到终端前，登录，调出实时流水，开始熟悉这堵绿色瀑布。

突然，他“咦”了一声。

“钟老师，您看这个——”

屏幕上，一条崭新的流水，由绿转红。

下一瞬，被系统“修正”，截断，抹平，干净得像从未存在过。

钟宁的瞳孔骤然收紧。

那套“自动修正”后门，彭守成亲手永久禁用留档的机制，本该已随系统升级，彻底封死。"""

    new_target = """晨光彻底破开云层，照亮了整座城市。

街角的百味坊快餐店窗明几净，刚出炉的热包子散发着腾腾麦香，滚烫现磨的豆浆在白瓷碗里泛着热气。庄叙陪着重获新生的妹妹坐在靠窗的座位上，小姑娘脸色红润，正小口喝着热豆浆。

风铃清脆地响了一声，钟宁推门而入。

庄叙抬起头，两人目光相遇，相视一笑。窗外阳光正好，照在干净无瑕的玻璃上，人间烟火如常，大地一片明澈。"""

    if old_target in content:
        content = content.replace(old_target, new_target)
        print("✅ 成功切除续集钩并替换为实体正向落点！")
    else:
        # 正则替换从 "新人坐到终端前" 开始到结尾的所有内容
        content = re.sub(r'新人坐到终端前.*', '', content, flags=re.DOTALL).strip()
        content += "\n\n" + """晨光彻底破开云层，照亮了整座城市。

街角的百味坊快餐店窗明几净，刚出炉的热包子散发着腾腾麦香，滚烫现磨的豆浆在白瓷碗里泛着热气。庄叙陪着重获新生的妹妹坐在靠窗的座位上，小姑娘脸色红润，正小口喝着热豆浆。

风铃清脆地响了一声，钟宁推门而入。

庄叙抬起头，两人目光相遇，相视一笑。窗外阳光正好，照在干净无瑕的玻璃上，人间烟火如常，大地一片明澈。"""
        print("✅ 正则方式切除续集钩并替换！")

    # 优化直白口号："透明本身就是守护"
    content = content.replace('——“透明本身就是守护。”', '。工位上，只端放着一张盖着红色印章的结案归档回执。')

    c.execute("UPDATE chapter_revision SET content = ? WHERE id = ?", (content, rev_id))
    conn.commit()

conn.close()
print("=== 数据库第 18 章修复完成 ===")
