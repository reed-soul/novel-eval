# -*- coding: utf-8 -*-
"""v3 收尾（扫描式，可反复跑）：
从 dist/audiobook-v3/ep0*/ 直接扫描产物重建 youtube-upload.json + bilibili-upload.json + UPLOAD.md。
时间轴从各 EP 的 SRT 挖章节头 cue；时长 probe（mp4 优先，缺则 mp3）。
今晚真图重渲后再跑一次即得最终版。
"""
import json, re, subprocess
from pathlib import Path

ROOT = Path("/Users/reed_soul/code/novel-eval/dist/audiobook-v3")
YJ = ROOT / "youtube-upload.json"
BJ = ROOT / "bilibili-upload.json"
UP = ROOT / "UPLOAD.md"
PLAYLIST = "悬疑借阅室｜最后一班森铁"

def probe_secs(f: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", str(f)], capture_output=True, text=True)
    return float(r.stdout.strip())

def fmt_dur(secs: float) -> str:
    m, s = int(secs // 60), int(secs % 60)
    return f"{m}分{s:02d}秒" if m < 60 else f"{m // 60}小时{m % 60}分"

def srt_stamps(srt: Path, first_ch: int):
    text = srt.read_text(encoding="utf-8")
    cues = re.findall(r"(\d{2}):(\d{2}):(\d{2})[,.]\d{3} --> .*?\n(.*?)(?:\n\n|\Z)", text, re.S)
    cn = "零一二三四五六七八九十"
    out = []
    for h, m, s, raw in cues:
        head = re.sub(r"<[^>]+>", "", raw).replace("\n", "").strip()
        mm = re.match(r"^第([一二三四五六七八九十\d]+)章[,，.、\s]*(.*)$", head)
        if not mm:
            continue
        n_raw = mm.group(1)
        if n_raw.isdigit():
            n = int(n_raw)
        else:
            cn = "零一二三四五六七八九"
            n = -1
            if n_raw == "十":
                n = 10
            elif n_raw.startswith("十") and len(n_raw) == 2 and n_raw[1] in cn:
                n = 10 + cn.find(n_raw[1])
            elif len(n_raw) == 1 and n_raw in cn:
                n = cn.find(n_raw)
        if first_ch <= n < first_ch + 3:
            out.append((f"{int(h)}:{m}:{s}" if int(h) > 0 else f"{int(m):02d}:{s}", f"第{n}章 {mm.group(2).strip()[:14]}"))
    return out

def main():
    eps = sorted(p for p in ROOT.glob("ep0*") if p.is_dir())
    yt, bili = [], []
    for idx, d in enumerate(eps, 1):
        mp4 = next(d.glob("EP*.mp4"), None)
        mp3 = next(d.glob("EP*.mp3"), None)
        srt = next(d.glob("EP*.srt"), None)
        if not (srt and (mp4 or mp3)):
            print(f"⚠ {d.name} 缺视频/音频或 SRT，跳过")
            continue
        media = mp4 or mp3
        stem = media.stem  # EP01_章名___章名
        m = re.match(r"EP\d+_(.+)", stem)
        parts = m.group(1).split("___") if m else [stem]
        label = parts[0] if len(parts) == 1 else f"{parts[0]} → {parts[-1]}"
        first_ch = idx * 3 - 2
        secs = probe_secs(media)
        stamps = srt_stamps(srt, first_ch)
        timeline = "\n".join(["00:00 冷开场｜欢迎光临悬疑借阅室"] + [f"{t} {lab}" for t, lab in stamps])
        finale = idx == len(eps)
        cta = ("全集完。借阅证请收好——书架上，下一本书已经开始落灰了。"
               if finale else "订阅即视为办理借阅证。睡不着，不算我们的责任。")
        desc = (
            "欢迎光临悬疑借阅室。今晚借出的这本，叫《最后一班森铁》。借阅时间，到天亮为止。\n\n"
            f"《最后一班森铁》第 {first_ch}-{first_ch + 2} 章：EP{idx:02d}｜{label}\n\n"
            f"⏱ 全长 {fmt_dur(secs)}\n"
            f"📖 章节时间轴\n{timeline}\n\n"
            f"📚 播放列表：{PLAYLIST}\n\n"
            "— 悬疑借阅室 —\n"
            f"{cta}\n\n"
            "本节目配音由 AI 语音合成生成，故事内容为原创虚构作品。\n\n"
            "#悬疑 #有声书 #悬疑小说"
        )
        yt.append({
            "file": str(media),
            "srt": str(srt),
            "playlist": PLAYLIST,
            "title": f"【有声书】最后一班森铁 EP{idx:02d}｜{label}",
            "description": desc,
            "tags": ["悬疑", "有声书", "悬疑小说", "有声小说", "中文有声书", "犯罪悬疑",
                     "最后一班森铁", f"第{first_ch}章"],
            "categoryId": "24",
            "videoReady": mp4 is not None,
        })
        bili.append({
            "file": str(media),
            "title": f"【东北悬疑有声书】最后一班森铁 EP{idx:02d}｜{label}",
            "description": desc,
            "tags": ["悬疑", "有声书", "东北", "犯罪悬疑", "推理", "最后一班森铁", "中文有声书", "AI配音", "长篇", "熬夜"],
            "cover": str(Path.home() / "Downloads" / "sentie-thumbnails" / f"EP{idx:02d}-缩略图.jpg"),
            "notes": "上传勾选「AI 生成内容」标识；分区建议：影视>短视频影视剪辑 或 生活>人文历史；类型选'自制'。",
            "videoReady": mp4 is not None,
        })
        print(f"EP{idx:02d}: {fmt_dur(secs)}｜{len(stamps)} 章节戳｜{'mp4 ✓' if mp4 else '待渲视频'}")

    YJ.write_text(json.dumps(yt, ensure_ascii=False, indent=2), encoding="utf-8")
    BJ.write_text(json.dumps(bili, ensure_ascii=False, indent=2), encoding="utf-8")
    UP.write_text(
        "# 森铁 v3 上传指引（真实场景图版）\n\n"
        "- 视频：dist/audiobook-v3/ep0*/EP*.mp4（1080p、12fps、-16 LUFS、软字幕+落雪、场景图轮换）\n"
        "- YouTube：youtube-upload.json（真实章节时间轴，触发章节面板）+ ~/Downloads/sentie-thumbnails/EP0x-缩略图.jpg；上传勾「合成内容」披露\n"
        "- B 站：bilibili-upload.json；上传勾「AI 生成内容」标识\n"
        "- ⚠️ 公开上传后本书不可再报番茄千字万金（独家互斥，详见 TONIGHT.md）\n",
        encoding="utf-8",
    )
    print(f"✓ {len(yt)} 集 → youtube-upload.json / bilibili-upload.json / UPLOAD.md")

if __name__ == "__main__":
    main()
