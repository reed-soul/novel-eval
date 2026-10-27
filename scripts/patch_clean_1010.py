#!/usr/bin/env python3
import re

book_path = 'research/daily-novels/2026-10-10-huagong-zilaishui/book.md'
text = open(book_path, 'r', encoding='utf-8').read()

# 1. 规避人名撞名
text = text.replace('贺临舟', '谭临舟')
text = text.replace('陆雨桐', '阮晓棠')
text = text.replace('沈砚清', '穆砚清')

# 2. 纯中文零英文替写
text = re.sub(r'U盘', '优盘', text)
text = re.sub(r'u盘', '优盘', text)
text = re.sub(r'U盾', '数字硬件密钥', text)

text = re.sub(r'EHS总监', '安全环保总监', text)
text = re.sub(r'EHS条线', '安全环保条线', text)
text = re.sub(r'EHS', '安全环保', text)

text = re.sub(r'COD', '化学需氧量', text)
text = re.sub(r'CMA实验室', '国家计量认证实验室', text)
text = re.sub(r'CMA', '国家计量认证', text)

text = re.sub(r'LIMS系统', '实验室信息管理系统', text)
text = re.sub(r'LIMS', '实验室信息管理系统', text)

text = re.sub(r'LED屏', '电子显示屏', text)
text = re.sub(r'LED红光', '电子屏红光', text)
text = re.sub(r'LED', '电子屏', text)

text = re.sub(r'原始log', '原始底层日志', text)
text = re.sub(r'原始日志、图谱、log', '原始日志、图谱、操作记录', text)
text = re.sub(r'log', '底层日志', text)

text = re.sub(r'412\.6GB', '四百一十二点六千兆字节', text)
text = re.sub(r'412\.6\s*GB', '四百一十二点六千兆字节', text)
text = re.sub(r'GB', '千兆字节', text)
text = re.sub(r'四百一十二点六个G', '四百一十二点六个千兆字节', text)
text = re.sub(r'四百多个G', '四百多千兆字节', text)

text = re.sub(r'DS-01', '董事会零一号专项', text)
text = re.sub(r'DS', '董事会专项', text)

# 3. 切除终章开放式续集钩，闭合正向双落点
cliff_anchor = '露台台阶下传来脚步声。'
if cliff_anchor in text:
    cut_pos = text.rfind(cliff_anchor)
    # 找到前面的结尾句
    text = text[:cut_pos].rstrip() + '\n\n晨风拂过江面，荡开层层金色的波纹，向着远处浩浩荡荡的大海奔流而去。白鹭在芦苇荡里清脆地啼鸣，天地间一片清朗。\n'

with open(book_path, 'w', encoding='utf-8') as f:
    f.write(text)

print("✅ 初步清洗与封堵完成！")

# 检查英文残留
rem_en = re.findall(r'[A-Za-z]+', text)
print(f"剩余英文字符串数量: {len(rem_en)}")
if rem_en:
    print(f"残留内容: {set(rem_en)}")
