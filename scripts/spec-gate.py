#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
spec-gate.py — 投稿/单集视频规格门（确定性检查，不调用任何模型）

设计原则：凡是能在文本里 grep 出真假的要求，都不该靠 LLM 评、也不该靠人读。
本脚本只做字符串与统计判定，不做价值判断。不过即 exit 1。

用法：
  python3 scripts/spec-gate.py <book.md> --profile salt      # 盐选 1.2-1.5 万字单篇
  python3 scripts/spec-gate.py <book.md> --profile legacy    # 现状 18 章 4 万字
  python3 scripts/spec-gate.py --dir research/daily-novels --profile salt   # 批量
  python3 scripts/spec-gate.py <book.md> --json              # 机器可读输出

退出码：0 全通过 / 1 有 FAIL / 2 参数或文件错误
"""

import argparse
import glob
import json
import os
import re
import sys

# ── 规则词表 ────────────────────────────────────────────────────────────────

SCAFFOLD = [
    r'[（(]\s*第[零一二三四五六七八九十百0-9]+\s*章\s*完\s*[）)]',
    r'[（(]\s*本章完[^）)]*[）)]',
    r'[（(]\s*全[书本]完[^）)]*[）)]',
    r'[（(]\s*本幕终[^）)]*[）)]',
    r'[（(]\s*未完待续[^）)]*[）)]',
    r'[（(]\s*本[章节][^）)]{0,8}[0-9]{2,6}\s*字[^）)]{0,4}[）)]',   # （本章约2800字）类生产备注（battle4 实抓）
    r'^\s*\*\*[^*]{0,24}(?:自检说明|修订说明|审阅反馈)[^*]{0,80}\*\*',   # LLM 修订元说明混入正文（battle5 v4 实抓）
    r'^\s*[*_]{0,2}\s*[（(]?\s*全[书本]完\s*[）)]?\s*[*_]{0,2}\s*$',
    r'^#{1,6}\s*全[书本]完\s*$',
]

# 句中夹的孤立英文残渣（battle4 实抓 "比 last 我记忆里"）：
# 规格要求纯中文零英文（技术名词中文替写）→ CJK 包夹的 2-8 字母 token 一律是生产残渣。
# 白名单是合法通用缩写。
ENGLISH_RESIDUE = re.compile(
    r'(?<=[\u4e00-\u9fa5，。：；、！？])\s*[A-Za-z]{2,8}\s*(?=[\u4e00-\u9fa5，。：；、！？])')
ENGLISH_WHITELIST = {
    'APP', 'DNA', 'RNA', 'RMB', 'ID', 'KTV', 'ICU', 'CT', 'PPT', 'USB',
    'AI', 'VR', 'AR', 'GPS', 'SIM', 'ATM', 'DNA', 'PTSD', 'LED',
}

OMNISCIENT = [
    r'他心想', r'她心想', r'他心里想', r'她心里想',
    r'他不知道的是', r'她不知道的是', r'没人知道', r'谁也不知道',
    r'没有人知道', r'殊不知', r'他们都不知道',
]

CONTINUATION_HOOK = [
    r'未完待续', r'敬请期待', r'第二部', r'下一部', r'下一季',
    r'故事才刚刚开始', r'这一切只是开始', r'这只是开始',
    r'真正的幕后', r'还有一个人', r'另一个真相',
]

# 《危货假验》式金句："报告会撒谎，轨迹不会"
SLOGAN = [
    r'[\u4e00-\u9fa5]{2,8}会撒谎[，,][\u4e00-\u9fa5]{2,8}不会',
    r'[\u4e00-\u9fa5]{2,8}不会撒谎',
    r'真相或许会迟到', r'正义或许会迟到',
    r'天网恢恢', r'法网恢恢', r'若要人不知',
    r'这世上没有', r'这就是人性', r'人心比',
]

CRIME = (
    '诈骗|故意杀人|故意伤害|职务侵占|伪证|毁灭证据|非法拘禁|投放危险物质|'
    '洗钱|拐卖|敲诈|勒索|纵火|放火|盗窃|贪污|受贿|行贿|滥用职权|玩忽职守|'
    '交通肇事|非法集资|组织领导传销|侵犯公民个人信息|强迫交易|寻衅滋事'
)

PUNISH = (
    '判处|判了|有期徒刑|无期徒刑|死刑|数罪并罚|伏法|落网|逮捕|刑拘|刑事拘留|'
    '留置|入狱|服刑|法办|获刑|终审|维持原判|剥夺政治权利'
)

# 前 300 字禁止出现的"体制背景"类词（编辑视角：这是简历，不是故事）
BACKGROUND = (
    '单位|科室|编制|岗位职责|工作流程|从业资格|毕业院校|从业[0-9一二三四五六七八九十]+年|'
    '职级|职务|主任科员|副科|正科|调研员|事业编|公务员考试|入职培训'
)

ENGLISH_RUN = re.compile(r'[A-Za-z]{4,}')
CJK = re.compile(r'[\u4e00-\u9fa5]')

PROFILES = {
    'salt': {
        'name': '盐选 / 单集中篇视频',
        'chars': (12000, 15000),
        'person': 'first',
        'sections': (6, 12),
        'forbid_chapter_token': True,
        'ending': True,
    },
    'fanqie': {
        'name': '番茄中短篇',
        'chars': (25000, 32000),
        'person': None,          # 官方不强制
        'sections': (6, 16),
        'forbid_chapter_token': True,
        'ending': True,
    },
    'legacy': {
        'name': '现状 18 章 4 万字',
        'chars': (30000, 50000),
        'person': None,
        'sections': (14, 22),
        'forbid_chapter_token': False,
        'ending': True,
    },
}


def strip_markup(text: str) -> str:
    """去掉 markdown 标题/分割线/加粗标记，只留正文，用于段长与字数统计。"""
    out = []
    for line in text.split('\n'):
        s = line.strip()
        if not s:
            continue
        if re.match(r'^#{1,6}\s', s) or re.match(r'^-{3,}$', s) or re.match(r'^\*{3,}$', s):
            continue
        s = re.sub(r'^[*_>]+\s*', '', s)
        s = re.sub(r'[*_]{1,3}', '', s).strip()
        if s:
            out.append(s)
    return out


def fix_mechanical(text: str) -> tuple[str, list[str]]:
    """只做确定性修复，不做任何创作判断。

    1. `# 第N章 章名` → `N、章名`（保留钩子，去掉"第/章"）
    2. 删除章尾脚手架行/片段
    3. 连续空行压缩
    """
    log = []
    out_lines = []
    for line in text.split('\n'):
        raw_line = line
        # 0. 章标题先归一化，再判重（必须在转换后比较，否则"第十二章…"与"十二、…"永不相等）
        m = re.match(r'^\s*#{0,6}\s*第\s*([零一二三四五六七八九十百0-9]{1,4})\s*章\s*(.*)$', line)
        is_chapter = bool(m) and len(line.strip()) <= 30 and not re.search(r'[。！？!?]$', line.strip())

        if is_chapter:
            title = m.group(2).strip().strip('*_# ').strip()
            new = f'{m.group(1)}、{title}' if title else m.group(1)
            last = next((x for x in reversed(out_lines) if x.strip()), None)
            if last is not None and new == last.strip():
                log.append(f'删重复节标题: {new}')
                continue
            out_lines.append(new)
            log.append(f'章标题: {raw_line.strip()[:30]} → {new}')
            continue
        # 2. 脚手架：整行删除
        if any(re.match(p, line) for p in SCAFFOLD):
            log.append(f'删脚手架行: {raw_line.strip()[:30]}')
            continue
        # 2b. 行内脚手架：抠掉
        cleaned = line
        for p in SCAFFOLD:
            cleaned = re.sub(p, '', cleaned)
        # 2c. 句中孤立英文残渣：CJK 包夹、非白名单的 2-8 字母 token 抠掉
        #     （battle4 实抓："比 last 我记忆里" → "比我记忆里"；规格禁英文，包夹即残渣）
        if ENGLISH_RESIDUE.search(cleaned):
            dropped = [m.group(0).strip() for m in ENGLISH_RESIDUE.finditer(cleaned)
                       if m.group(0).strip().upper() not in ENGLISH_WHITELIST]
            if dropped:
                def _drop(m):
                    return m.group(0) if m.group(0).strip().upper() in ENGLISH_WHITELIST else ''
                cleaned = ENGLISH_RESIDUE.sub(_drop, cleaned)
                log.append(f'抠英文残渣: {",".join(dropped)[:40]}')
        cleaned = re.sub(r'[ \t]+$', '', cleaned).strip()
        if cleaned != line.strip() and cleaned:
            log.append(f'抠内联脚手架: {raw_line.strip()[:30]}')
        if cleaned or line.strip() == '':
            out_lines.append(cleaned)

    text = '\n'.join(out_lines)
    text = re.sub(r'\n{3,}', '\n\n', text)
    # 4. 去掉正文首行的书名 H1（投稿时书名单独填，正文不重复）
    lines = text.split('\n')
    for idx, ln in enumerate(lines):
        if not ln.strip():
            continue
        if re.match(r'^#\s+', ln) and '章' not in ln:
            log.append(f'删书名行: {ln.strip()[:30]}')
            lines.pop(idx)
        break
    return '\n'.join(lines).lstrip('\n'), log


def check(book_path: str, profile_key: str) -> dict:
    prof = PROFILES[profile_key]
    raw = open(book_path, encoding='utf-8').read()
    paras = strip_markup(raw)
    body = '\n'.join(paras)
    chars = len(CJK.findall(body))
    total_chars = len(body)
    results = []

    def add(rid, label, ok, detail, hard=True):
        results.append({'id': rid, 'label': label, 'pass': bool(ok),
                        'detail': detail, 'hard': hard})

    # R01 字数区间
    lo, hi = prof['chars']
    add('R01', f'字数 {lo}–{hi}', lo <= total_chars <= hi,
        f'实际 {total_chars} 字（汉字 {chars}）')

    # R02 人称
    if prof['person'] == 'first':
        wo = len(re.findall(r'我(?!们)', body))
        omni = []
        for p in OMNISCIENT:
            m = re.findall(p, body)
            if m:
                omni.extend(m)
        add('R02', '第一人称、无全知句', wo >= 15 and not omni,
            f'"我" {wo} 处；全知句命中 {len(omni)} 处 '
            f'{("（" + "、".join(sorted(set(omni))[:4]) + "）") if omni else ""}')

    # R03 体例（在 raw 上数，标题行不能被 strip_markup 吃掉）
    # 分节行判定：数字/中文数字 + 顿号/点，且该行短、无句末标点（避免把正文列表项误计为节）
    sec_marks = []
    for ln in raw.split('\n'):
        s = re.sub(r'^\s*#{1,6}\s*', '', ln).strip()
        if not s or len(s) > 30 or re.search(r'[。！？!?]$', s):
            continue
        if re.match(r'^(?:\d{1,2}|[一二三四五六七八九十]{1,3})\s*[、.．]', s) \
                or re.match(r'^【\d{1,2}】', s) \
                or re.match(r'^\d{1,2}$', s):
            sec_marks.append(s)
    sec_mark = len(sec_marks)
    ch_token = len(re.findall(r'第\s*[零一二三四五六七八九十百0-9]{1,4}\s*章', raw))
    slo, shi = prof['sections']
    if prof['forbid_chapter_token']:
        add('R03', f'分节 {slo}–{shi} 个、"第N章"零命中',
            slo <= sec_mark <= shi and ch_token == 0,
            f'分节 {sec_mark} 个；"第N章" {ch_token} 处')
    else:
        add('R03', f'分章 {slo}–{shi} 个', slo <= ch_token <= shi,
            f'"第N章" {ch_token} 处')

    # R04 段落长度
    lens = [len(p) for p in paras if len(p) > 1]
    if lens:
        mx = max(lens)
        avg = sum(lens) / len(lens)
        over = sum(1 for x in lens if x > 100)
        add('R04', '最长段 ≤100 字、均段 ≤80 字',
            mx <= 100 and avg <= 80,
            f'最长 {mx} 字；均 {avg:.1f} 字；>100 字段落 {over}/{len(lens)} '
            f'({over/len(lens)*100:.0f}%)')

    # R05 脚手架残留
    hits = []
    for p in SCAFFOLD:
        for m in re.finditer(p, raw, re.M):
            hits.append(m.group(0).strip()[:24])
    add('R05', '零章尾脚手架', not hits,
        f'命中 {len(hits)} 处' + (f'：{" / ".join(hits[:5])}' if hits else ''))

    # R05b 节标题/编号不重复（battle4 实抓：章标题重复进交付稿）
    heads = [h.strip() for h in re.findall(r'^\s*(?:\d+\s*、.+|#\s*\S.*)$', raw, re.M)]
    dup_h = sorted({h for h in heads if heads.count(h) > 1})
    nums = re.findall(r'^\s*(\d+)\s*、', raw, re.M)
    dup_n = sorted({n for n in nums if nums.count(n) > 1})
    add('R05b', '节标题与编号不重复', not dup_h and not dup_n,
        ('重复标题：' + ' / '.join(dup_h[:3]) if dup_h else '')
        + ('；' if dup_h and dup_n else '')
        + ('重复编号：' + '、'.join(dup_n[:5]) if dup_n else '')
        or '干净')

    # R06 纯中文
    eng = sorted(set(ENGLISH_RUN.findall(body)))
    add('R06', '无英文残留（≥4 字母）', not eng,
        f'命中 {len(eng)} 种' + (f'：{", ".join(eng[:8])}' if eng else ''))

    # R07 结局四件套
    if prof['ending']:
        tail = body[-900:]
        crime = sorted(set(re.findall(CRIME, tail)))
        punish = sorted(set(re.findall(PUNISH, tail)))
        hook = [h for p in CONTINUATION_HOOK for h in re.findall(p, tail)]
        add('R07a', '末 900 字有罪名点名', bool(crime),
            f'{("命中：" + "、".join(crime)) if crime else "零命中"}')
        add('R07b', '末 900 字有刑罚落地', bool(punish),
            f'{("命中：" + "、".join(punish)) if punish else "零命中"}')
        add('R07c', '末 900 字无续集钩', not hook,
            f'{("命中：" + "、".join(set(hook))) if hook else "零命中"}')

    # R08 末 3 句无口号金句
    tail3 = '。'.join([s for s in re.split(r'[。！？\n]', body[-300:]) if s.strip()][-3:])
    slog = [h for p in SLOGAN for h in re.findall(p, tail3)]
    add('R08', '末 3 句无口号/金句', not slog,
        f'{("命中：" + "、".join(set(slog))) if slog else "零命中"}')

    # R09 前 300 字三要素
    head = body[:300]
    has_wo = bool(re.search(r'我', head))
    bg = sorted(set(re.findall(BACKGROUND, head)))
    add('R09', '前 300 字有"我"、无体制背景', has_wo and not bg,
        f'"我"{"有" if has_wo else "无"}；背景词 {len(bg)} 种'
        + (f'：{"、".join(bg)}' if bg else ''))

    # R10 反转密度代理指标（真反转需人工标，此处只查硬空档）
    if lens:
        # 以分节/分章为界，看每节末段是否有钩子迹象
        blocks = re.split(
            r'^\s*#{0,6}\s*(?:第\s*[零一二三四五六七八九十百0-9]{1,4}\s*章|\d{1,2}\s*$|【\d{1,2}】|[一二三四五六七八九十]{1,3}\s*[、.．])',
            raw, flags=re.M)
        blocks = [b for b in blocks if len(b.strip()) > 200]
        weak = 0
        for b in blocks:
            ps = [p for p in strip_markup(b) if p]
            if not ps:
                continue
            last = ps[-1]
            if not ('？' in last or '?' in last or len(last) <= 30):
                weak += 1
        add('R10', '各节末段有钩子（代理指标）', weak == 0,
            f'{len(blocks)} 节中 {weak} 节末段无钩子迹象', hard=False)

    hard_fail = [r for r in results if r['hard'] and not r['pass']]
    return {
        'file': book_path,
        'profile': profile_key,
        'profile_name': prof['name'],
        'chars': total_chars,
        'pass': not hard_fail,
        'fail_count': len(hard_fail),
        'checks': results,
    }


def render(res: dict) -> str:
    icon = lambda ok: 'PASS' if ok else 'FAIL'
    lines = [f'── {res["file"]}  [{res["profile_name"]}]  正文 {res["chars"]} 字']
    for r in res['checks']:
        tag = '' if r['hard'] else ' (soft)'
        lines.append(f'  [{icon(r["pass"])}] {r["id"]} {r["label"]}{tag} — {r["detail"]}')
    verdict = '通过' if res['pass'] else f'不通过（{res["fail_count"]} 项）'
    lines.append(f'  => {verdict}')
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('book', nargs='?')
    ap.add_argument('--profile', default='salt', choices=list(PROFILES))
    ap.add_argument('--dir')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--fix', action='store_true',
                    help='确定性修复（章标题改数字、删脚手架），需配 -o 输出，绝不原地覆盖')
    ap.add_argument('-o', '--output', help='修复后的输出路径')
    args = ap.parse_args()

    if args.fix:
        if not args.book or not args.output:
            print('--fix 需要同时指定 <book> 和 -o <output>', file=sys.stderr)
            return 2
        raw = open(args.book, encoding='utf-8').read()
        fixed, log = fix_mechanical(raw)
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(fixed)
        print(f'修复 {len(log)} 处 → {args.output}')
        for item in log[:40]:
            print(f'  · {item}')
        if len(log) > 40:
            print(f'  … 另 {len(log) - 40} 处')
        return 0

    files = []
    if args.dir:
        files = sorted(glob.glob(os.path.join(args.dir, '*', 'book.md')))
    elif args.book:
        if not os.path.isfile(args.book):
            print(f'文件不存在: {args.book}', file=sys.stderr)
            return 2
        files = [args.book]
    else:
        ap.print_help()
        return 2

    if not files:
        print('未找到 book.md', file=sys.stderr)
        return 2

    results = [check(f, args.profile) for f in files]

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        for r in results:
            print(render(r))
            print()
        nfail = sum(1 for r in results if not r['pass'])
        print(f'合计 {len(results)} 部，通过 {len(results) - nfail} 部，不通过 {nfail} 部')

    return 0 if all(r['pass'] for r in results) else 1


if __name__ == '__main__':
    sys.exit(main())
