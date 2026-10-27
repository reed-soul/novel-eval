#!/usr/bin/env python3
import re, sqlite3

book_path = 'research/daily-novels/2026-10-10-huagong-zilaishui/book.md'
text = open(book_path, 'r', encoding='utf-8').read()

# -------------------------------------------------------------------------
# 1. ch005 坟前遭遇黑车围堵+滩涂泥潭反杀（打破纯文戏静场，增加惊险动作场面）
# -------------------------------------------------------------------------
old_ch5_grave = '''江承安靠着冰凉的墙，慢慢滑坐到台阶上。

他想起戴天宏那句话：你对面不是我，是一台机器。

今晚，机器只用了五十分钟，抹掉了三年的痕迹。



凌晨三点，江承安没回宿舍。

他开车沿江堤往下游走了十一公里，土路尽头是一片老坟地。他父亲的坟在第三排，紧挨着沧江。'''

new_ch5_grave = '''江承安靠着冰凉的墙，慢慢滑坐到台阶上。

他想起戴天宏那句话：你对面不是我，是一台机器。

今晚，机器只用了五十分钟，抹掉了三年的痕迹。



凌晨三点，江承安没回宿舍。

后视镜里，两道雪亮的远光灯如影随形贴了整整六公里。一辆没有牌照的黑色重型越野车突然轰鸣提速，企图在江堤窄道上将他的旧皮卡硬生生别进深水区！

对方是冲着他副驾上的现场原始水样封存箱来的！

江承安眼神一凛，没有踩刹车，反而猛打方向盘，借着自幼在滩涂长大的记忆，直接冲下江堤土坡，顺着一条废弃的运砂暗道疾驰。黑色越野车紧追不舍狂扑而下，仗着马力大企图封死去路。

“砰！”一声闷响！

越野车沉重的车头猛地陷进前方的潮间带粉细砂中，四个两百多匹马力的大泥地胎疯狂打滑，瞬间被黏稠的滩涂泥浆吞没到底盘，排气管发出绝望的轰鸣！

江承安在二十米外稳稳停下皮卡，跳下车，拎着绝缘扳手冷冷站在泥潭边。越野车里两个戴口罩的壮汉气急败坏地踹门，靴子一落地便陷到膝盖，动弹不得。

“回去告诉戴天宏，”江承安用手机高清录下陷车画面与车架暗码，冷冷掷地有声，“沧江的水吃得下泥沙，也咽得下毒药，但吃不下他的烂心烂肺！”

摆脱了追兵，他开车继续沿江堤往下游走了五公里。土路尽头是一片老坟地，他父亲的坟在第三排，紧挨着沧江。'''

assert old_ch5_grave in text, "old_ch5_grave not found"
text = text.replace(old_ch5_grave, new_ch5_grave)

# -------------------------------------------------------------------------
# 2. ch016 解决ch015绿灯悬念：暴力断电物理抢救磁盘（解决泄力，增加高燃动作）
# -------------------------------------------------------------------------
old_ch16_start = '''# 第16章 不干净的拼图

凌晨一点，设备间。

倒计时还剩两小时四十分。穆砚清把一块物理盘塞进防静电袋，推给江承安。

“数据是死的，钱是活的。”他说，“凭证链条在宏晟财务体系外面，走的是谭临舟的手。今晚他约了阮晓棠。那一环能不能扣上，看你的记者了。”'''

new_ch16_start = '''# 第16章 不干净的拼图

凌晨一点，设备间深处。

机柜最底层那台老旧服务器的绿灯疯狂暴闪，散热风扇发出刺耳的尖啸！屏幕上原本被锁死的倒爬进度条，正以肉眼可见的速度重新跳动——百分之九十七、百分之九十八！

“有人在通过外网双重跳板远程激活底层清除脚本！”邱小凡急得额头冷汗直冒，十指在键盘上敲出残影，屏幕上却接连弹出大红色的‘无权干预’警告，“崔建德在用备用密钥强行覆写磁盘！江工，软件层彻底锁死了！”

倒计时只剩八秒！

江承安眼中厉色一闪，没有任何犹豫，反手抄起墙角沉重的二氧化碳灭火器，对准服务器背后粗壮的冗余供电铜排与双路光纤跳线，以全力狠狠砸下！

“刺啦——！！”

一团刺目的蓝色电火花爆闪，浓烈焦糊味腾空而起，机房内所有的红灯报警蜂鸣在这一瞬轰然寂灭！屏幕上的进度条在百分之九十九秒停住！

“停住了！”邱小凡脱力般瘫坐在地上。

“物理断电切断了远程指令，但主板残存电容撑不了多久，必须在三分钟内完成阵列热拔插！”穆砚清快步扑到机柜前，熟练地旋开四枚镀金防拆防爆螺丝，用无静电钳精准卡出那块沉重无比的工业级阵列物理固态盘，迅速塞进加厚防静电密封袋，重重拍在江承安手心。

“四百一十二个千兆字节的三年原始全量记录，毫发无损抢出来了！”穆砚清剧烈喘息着，扶着机柜站直，“承安，数据是死的，钱是活的。凭证链条在宏晟财务体系外面，走的是谭临舟的手。今晚他约了阮晓棠。那一环能不能扣上，看你的记者了。”'''

assert old_ch16_start in text, "old_ch16_start not found"
text = text.replace(old_ch16_start, new_ch16_start)

with open(book_path, 'w', encoding='utf-8') as f:
    f.write(text)

print("✅ ch005动作追逐反杀与ch016机房灭火器暴力断电抢救磁盘补丁应用成功！")

# 同步到 writer.db
db_path = 'data/writer/writer.db'
project_id = 'b68db381-4041-4d67-94cf-0fb3edbf46b0'
conn = sqlite3.connect(db_path)
c = conn.cursor()

raw_chapters = re.split(r'(?m)^(# 第[0-9一二三四五六七八九十百]+章.*?)$', text)
chapter_map = {}
for i in range(1, len(raw_chapters), 2):
    header = raw_chapters[i].strip()
    body = raw_chapters[i+1].strip() if i+1 < len(raw_chapters) else ''
    m = re.match(r'# 第([0-9]+)章\s*(.*)', header)
    if m:
        pos = int(m.group(1))
        title = m.group(2).strip()
        chapter_map[pos] = (title, body)

query = '''
SELECT c.id, co.position, c.active_revision_id
FROM chapter c
JOIN chapter_outline co ON c.outline_id = co.id
WHERE c.project_id = ?
ORDER BY co.position ASC
'''
c.execute(query, (project_id,))
db_chapters = c.fetchall()

updated = 0
for ch_id, pos, rev_id in db_chapters:
    if pos in chapter_map:
        title, body = chapter_map[pos]
        wc = len(body)
        c.execute('''
            UPDATE chapter_revision 
            SET title = ?, content = ?, word_count = ?
            WHERE id = ?
        ''', (title, body, wc, rev_id))
        updated += 1

conn.commit()
print(f'成功同步 {updated} 章节到 writer.db！')
