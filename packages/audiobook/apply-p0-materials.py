# -*- coding: utf-8 -*-
"""按竞品报告 P0 项更新上传物料（2026-08-29）：
1) 标题改钩子优先（公式 B：片名+冷开场钩子，集数后置）
2) 简介补 hashtag 阵（对齐夜语轶事结构）
3) 时间轴保持每戳一行 00:00 开头（原生章节，全赛道无人用=差异化）
EP01 已上线，另出 youtube-ep01-fix.txt 供用户在 Studio 里替换简介。"""
import json
from pathlib import Path

ROOT = Path("/Users/reed_soul/code/novel-eval/dist/audiobook-v3")
YJ = ROOT / "youtube-upload.json"
BJ = ROOT / "bilibili-upload.json"

# 公式 B 钩子标题（YouTube）：片名章名 + 具体钩子句 + 系列名 + 集数后置
YT_TITLES = {
    1: "【完结有声】墙里的骨头：拆墙拆出一九九八年的旧账｜最后一班森铁 01",
    2: "【完结有声】火墙：墙里砌着一个人，账上却查无此人｜最后一班森铁 02",
    3: "【完结有声】账太清的人活不长：一盘旧磁带，录着局长的原声｜最后一班森铁 03",
    4: "【完结有声】吊销：记者证被收走那天，证据正好寄到北京｜最后一班森铁 04",
    5: "【完结有声】一路平安：这面墙十二年后会塌，他说他算过｜最后一班森铁 05 完结",
}
# B 站标题（保留频道前缀，钩子同样前置）
BILI_TITLES = {
    1: "【东北悬疑有声书】墙里的骨头：拆墙拆出一九九八年的旧账｜最后一班森铁 01",
    2: "【东北悬疑有声书】火墙：墙里砌着一个人，账上却查无此人｜最后一班森铁 02",
    3: "【东北悬疑有声书】账太清的人活不长：一盘旧磁带，录着局长的原声｜最后一班森铁 03",
    4: "【东北悬疑有声书】吊销：记者证被收走那天，证据正好寄到北京｜最后一班森铁 04",
    5: "【东北悬疑有声书】一路平安：这面墙十二年后会塌，他说他算过｜最后一班森铁 05 完结",
}
HASHTAGS = "#悬疑小说 #有声书 #完结文 #一口气看完系列 #悬疑 #犯罪 #东北 #最后一班森铁"
OLD_TAGS_RE = __import__("re").compile(r"#悬疑\s*#\S+\s*#悬疑小说\s*$")

def with_hashtags(desc: str) -> str:
    # 替换旧的三标签行（否则去重判断会跳过新标签阵）
    replaced = OLD_TAGS_RE.sub("", desc).rstrip()
    if "#悬疑小说 #有声书 #完结文" in replaced:
        return desc
    return replaced + "\n\n" + HASHTAGS

yt = json.loads(YJ.read_text())
for i, item in enumerate(yt, 1):
    item["title"] = YT_TITLES[i]
    item["description"] = with_hashtags(item["description"])
YJ.write_text(json.dumps(yt, ensure_ascii=False, indent=2), encoding="utf-8")

bj = json.loads(BJ.read_text())
for i, item in enumerate(bj, 1):
    item["title"] = BILI_TITLES[i]
    item["description"] = with_hashtags(item["description"])
BJ.write_text(json.dumps(bj, ensure_ascii=False, indent=2), encoding="utf-8")

# EP01 已上线：单独输出 Studio 替换用简介（多行时间轴 → 原生章节）
ep1 = yt[0]
(ROOT / "youtube-ep01-desc-fix.txt").write_text(ep1["description"], encoding="utf-8")

for i, item in enumerate(yt, 1):
    print(f"EP0{i}: {item['title']}")
print("✓ 两份 json 已更新；EP01 简介修正稿 → youtube-ep01-desc-fix.txt")
