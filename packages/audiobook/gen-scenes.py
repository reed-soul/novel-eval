# -*- coding: utf-8 -*-
"""Gemini 场景图批量生成驱动（2026-08-28，一次性）。
消费 dist/audiobook-v3/scenes.json → dist/audiobook-v3/scenes/NN-<slot>.jpg
可断点续跑：目标已存在即跳过。每张间隔 ≥12s（会员限速纪律）。"""
import json, subprocess, sys, time, os, glob
from pathlib import Path

REPO = Path("/Users/reed_soul/code/novel-eval")
SCENES_JSON = REPO / "dist/audiobook-v3/scenes.json"
OUT_DIR = REPO / "dist/audiobook-v3/scenes"
TMP_DIR = OUT_DIR / "_tmp"
INTERVAL_S = 12

def main():
    data = json.loads(SCENES_JSON.read_text())
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    # 清空 tmp，避免误取旧文件
    for f in TMP_DIR.glob("gemini_*.png"):
        f.unlink()

    todo = []
    for ch in data:
        for s in ch["scenes"]:
            target = OUT_DIR / f"{ch['pos']:02d}-{s['slot']}.jpg"
            if target.exists() and target.stat().st_size > 30_000:
                continue
            todo.append((ch["pos"], s["slot"], s["prompt"], target))
    print(f"待生成 {len(todo)} 张（已有跳过）", flush=True)
    if not todo:
        return

    fails = []
    for i, (pos, slot, prompt, target) in enumerate(todo, 1):
        label = f"{pos:02d}-{slot}"
        try:
            r = subprocess.run(
                ["opencli", "gemini", "image", prompt, "--rt", "16:9",
                 "--op", str(TMP_DIR), "--timeout", "480"],
                capture_output=True, text=True, timeout=540)
            outs = sorted(TMP_DIR.glob("gemini_*.png"), key=os.path.getmtime)
            if r.returncode != 0 or not outs:
                print(f"[{i}/{len(todo)}] {label} FAIL rc={r.returncode} {r.stdout[-120:]}{r.stderr[-120:]}", flush=True)
                fails.append(label)
                time.sleep(INTERVAL_S)
                continue
            src = outs[-1]
            subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "90",
                            str(src), "--out", str(target)],
                           capture_output=True, timeout=60)
            src.unlink()
            ok = target.exists() and target.stat().st_size > 30_000
            print(f"[{i}/{len(todo)}] {label} {'OK' if ok else 'BAD'} {target.stat().st_size//1024}KB", flush=True)
            if not ok:
                fails.append(label)
        except subprocess.TimeoutExpired:
            print(f"[{i}/{len(todo)}] {label} TIMEOUT", flush=True)
            fails.append(label)
        time.sleep(INTERVAL_S)

    print(f"完成，失败 {len(fails)}: {fails}", flush=True)

if __name__ == "__main__":
    main()
