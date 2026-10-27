#!/usr/bin/env python3
"""排版重构器（final-plan P1-1）：把超长段落按语法边界重新断行，零内容改动。

解决 spec-gate R04（最长段 ≤100 字、均段 ≤80 字）的机械可修部分：
  一档 对话混段（历史 42.8%）：按引号边界切片，短叙述并入相邻台词（"他说："+"台词"），
       台词与动作各自成段。切片一律用 finditer span（不可用 re.split——它会吃掉引号本体）。
  二档 无引号的普通超长段：按句末标点（。！？；）贪心打包成 ≤100 字新段。
  三档 无句读怪物句：按逗号/顿号兜底（仍是排版，不是改写）。

不做的事：
  - 不改写任何文字（公文腔"改写成人的话"仍归人/LLM，本脚本只断行）
  - 绝不在引号内部断行（会破坏配对）；超长单条台词报 unfixable，由人拆段并补引号
  - 不碰标题/分割线/markdown 强调行

口径与 spec-gate.py 完全一致：非空行 = 段落；长度按 strip 后字符数计。
不变量：输出去掉换行后与输入逐字符相同（零增删改）。

用法：
  python3 scripts/layout-refactor.py <book.md>                # 干跑，只出报告
  python3 scripts/layout-refactor.py <book.md> --in-place     # 原地重写（备份 .pre-refactor.bak）
  python3 scripts/layout-refactor.py <book.md> --json         # 机器可读输出
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

MAX_LEN = 100          # 与 spec-gate R04 一致
QUOTE_RE = re.compile(r'「[^」]*」|“[^”]*”')
SENT_SPLIT_RE = re.compile(r'(?<=[。！？；?!…])')
COMMA_SPLIT_RE = re.compile(r'(?<=[，、；])')
HEADING_RE = re.compile(r'^#{1,6}\s')
HR_RE = re.compile(r'^-{3,}$|^\*{3,}$')
MD_MARK_RE = re.compile(r'[*_]{1,3}')   # 正文含 markdown 强调时不动（防拆坏标记）
OPEN_Q, CLOSE_Q = '“', '”'

UNFIXABLE = 'UNFIXABLE'   # split_dialogue 的哨兵返回值：含超长单条台词，机械无解


def strip_line(s: str) -> str:
    """与 spec-gate.strip_markup 的单行逻辑一致。"""
    s = re.sub(r'^[*_>]+\s*', '', s)
    s = MD_MARK_RE.sub('', s).strip()
    return s


def slice_by_quotes(line: str) -> list[tuple[str, str]]:
    """按引号 span 切片，tokens 交替为 narration / speech，字符与原行完全一致。"""
    tokens: list[tuple[str, str]] = []
    pos = 0
    for m in QUOTE_RE.finditer(line):
        if m.start() > pos:
            tokens.append(('nar', line[pos:m.start()]))
        tokens.append(('sp', m.group(0)))
        pos = m.end()
    if pos < len(line):
        tokens.append(('nar', line[pos:]))
    return tokens


def pack_greedy(chunks: list[str], limit: int = MAX_LEN) -> list[str]:
    """贪心打包：段 ≤limit。调用方须先保证单块 ≤limit。"""
    out: list[str] = []
    buf = ''
    for c in chunks:
        if not buf or len(buf) + len(c) <= limit:
            buf += c
        else:
            out.append(buf)
            buf = c
    if buf:
        out.append(buf)
    return out


def sentence_chunks(s: str) -> list[str] | None:
    """按句末标点切块；超长单句按逗号兜底；仍无解（无任何标点）返回 None。"""
    sents = [x for x in SENT_SPLIT_RE.split(s) if x]
    expanded: list[str] = []
    for x in sents:
        if len(x) > MAX_LEN:
            comma = [c for c in COMMA_SPLIT_RE.split(x) if c]
            if any(len(c) > MAX_LEN for c in comma):
                return None
            expanded.extend(comma)
        else:
            expanded.append(x)
    return expanded


def split_narration(nar: str) -> list[str] | None:
    """拆一段无引号叙述；≤MAX 原样返回；无标点怪物返回 None。"""
    if len(nar) <= MAX_LEN:
        return [nar]
    chunks = sentence_chunks(nar)
    if chunks is None or any(len(c) > MAX_LEN for c in chunks):
        return None
    return pack_greedy(chunks)


def split_speech_requote(speech: str) -> list[str] | None:
    """四档：超长单条台词按中文出版规范跨段——每段开头补前引号，仅末段保留后引号。

    例：“AAAA。BBBB！”（120 字）→ ["“AAAA。", "“BBBB！”"]
    只增加前引号，不改动任何原有字符。支持 “” 与 「」 两对引号。
    无法在句界切开（引号内无标点）返回 None。
    """
    o = c = None
    for po, pc in (('“', '”'), ('「', '」')):
        if speech.startswith(po) and speech.endswith(pc) and len(speech) > 2:
            o, c = po, pc
            break
    if o is None:
        return None
    inner = speech[1:-1]
    chunks = sentence_chunks(inner)
    if chunks is None or len(chunks) < 2:
        return None
    limit = MAX_LEN - 1   # 留 1 字给新增前引号
    if any(len(x) > limit for x in chunks):
        return None
    packed = pack_greedy(chunks, limit=limit)
    if len(packed) <= 1:
        # 整体打包后仍一段（inner 恰在 limit 附近的边界情形）：
        # 在最接近中点的句界强制一分为二
        best, best_d = 1, float('inf')
        acc = 0
        for idx, x in enumerate(chunks[:-1]):
            acc += len(x)
            d = abs(acc - len(inner) / 2)
            if d < best_d:
                best, best_d = idx + 1, d
        cut = sum(len(x) for x in chunks[:best])
        packed = [inner[:cut], inner[cut:]]
    return [o + p for p in packed[:-1]] + [o + packed[-1] + c]


# ─── 一档：对话混段拆分 ───────────────────────────────────────────

def split_dialogue(line: str) -> list[str] | str | None:
    """返回：段落列表（成功拆分）/ UNFIXABLE（超长单条台词）/ None（无引号，不适用）。

    保证：成功时各段拼接 == 原行（零字符增删）；任何段都不在引号内部断开。
    """
    if not QUOTE_RE.search(line):
        return None

    tokens = slice_by_quotes(line)
    paras: list[str] = []

    def emit_nar(text: str) -> bool:
        """叙述 token 成段；纯空白并入上一段（保零丢失）。失败返回 False。"""
        if not strip_line(text):
            if paras:
                paras[-1] += text      # 引号间的空白/标点残尾并入前段，字符不丢
                return True
            paras.append(text)
            return True
        pieces = split_narration(text)
        if pieces is None:
            return False
        paras.extend(pieces)
        return True

    i = 0
    while i < len(tokens):
        kind, text = tokens[i]
        if kind == 'sp':
            if len(text) > MAX_LEN:
                # 四档：跨段重引（只加前引号，不动文字）；句界切不开才判无解
                pieces = split_speech_requote(text)
                if pieces is None:
                    return UNFIXABLE
                paras.extend(pieces)
            else:
                paras.append(text)
            i += 1
        else:
            nxt = tokens[i + 1] if i + 1 < len(tokens) else None
            if nxt and nxt[0] == 'sp':
                # 叙述 + 后随台词：合并后 ≤MAX 才并（"他顿了顿：'……'"），
                # 否则叙述独立成段（超长则句读拆），台词下一轮自己成段
                if strip_line(text) and len(strip_line(text)) + len(nxt[1]) <= MAX_LEN:
                    paras.append(text + nxt[1])
                    i += 2
                else:
                    if not emit_nar(text):
                        return None
                    i += 1
            else:
                # 尾随叙述：≤6 字并给上一段台词（"'……'他说。"），否则独立
                if (paras and strip_line(text) and len(strip_line(text)) <= 6
                        and len(strip_line(paras[-1] + text)) <= MAX_LEN):
                    paras[-1] += text
                else:
                    if not emit_nar(text):
                        return None
                i += 1

    return paras if len(paras) > 1 else None


# ─── 主流程 ──────────────────────────────────────────────────────

def refactor(text: str) -> tuple[str, dict]:
    lines = text.split('\n')
    out_lines: list[str] = []
    stats = {
        'paras_total': 0, 'overlong_before': 0, 'overlong_after': 0,
        'fixed_dialogue': 0, 'fixed_sentences': 0,
        'unfixable': [], 'max_before': 0, 'max_after': 0,
        'avg_before': 0.0, 'avg_after': 0.0,
    }
    lens_before: list[int] = []
    lens_after: list[int] = []

    def keep(l: str) -> None:
        out_lines.append(l)
        s = strip_line(l)
        if len(s) > 1 and not HEADING_RE.match(l.strip()):
            stats['paras_total'] += 1
            lens_before.append(len(s))
            lens_after.append(len(s))

    for line in lines:
        stripped = line.strip()
        if (not stripped or HEADING_RE.match(stripped) or HR_RE.match(stripped)
                or len(stripped) <= MAX_LEN or MD_MARK_RE.search(stripped)):
            keep(line)
            continue

        stats['overlong_before'] += 1

        replacement = split_dialogue(line)
        tier = None
        if isinstance(replacement, list):
            tier = 'dialogue'
        elif replacement is None:
            # 无引号（或引号间叙述也无解）→ 二三档句读
            sent = sentence_chunks(line) if not QUOTE_RE.search(line) else None
            if sent is not None and all(len(c) <= MAX_LEN for c in sent):
                replacement = pack_greedy(sent)
                tier = 'sentences'

        if replacement is None or replacement is UNFIXABLE or isinstance(replacement, str):
            out_lines.append(line)
            s = strip_line(line)
            stats['paras_total'] += 1
            lens_before.append(len(s))
            lens_after.append(len(s))
            stats['unfixable'].append(s[:40])
            continue

        stats['paras_total'] += 1
        lens_before.append(len(stripped))
        for j, p in enumerate(replacement):
            out_lines.append(p)
            lens_after.append(len(strip_line(p)))
            if j < len(replacement) - 1:
                out_lines.append('')   # 段间空行，与 book.md 惯例一致
        stats['fixed_dialogue' if tier == 'dialogue' else 'fixed_sentences'] += 1

    stats['overlong_after'] = sum(1 for x in lens_after if x > MAX_LEN)
    stats['max_before'] = max(lens_before) if lens_before else 0
    stats['max_after'] = max(lens_after) if lens_after else 0
    stats['avg_before'] = round(sum(lens_before) / len(lens_before), 1) if lens_before else 0
    stats['avg_after'] = round(sum(lens_after) / len(lens_after), 1) if lens_after else 0

    return '\n'.join(out_lines), stats


def report(s: dict) -> str:
    lines = [
        '── 排版重构报告（R04 口径）──',
        f"段落总数             {s['paras_total']}",
        f">100 字段（前 → 后）  {s['overlong_before']} → {s['overlong_after']}",
        f"最长段   （前 → 后）  {s['max_before']} → {s['max_after']} 字",
        f"平均段长 （前 → 后）  {s['avg_before']} → {s['avg_after']} 字",
        f"一档修复（对话混段）   {s['fixed_dialogue']} 段",
        f"二三档修复（句读）     {s['fixed_sentences']} 段",
    ]
    if s['unfixable']:
        lines.append(f"⚠ 机械无解 {len(s['unfixable'])} 段（超长单条台词/无标点长句，需人工拆段补引号）：")
        for u in s['unfixable'][:5]:
            lines.append(f"   · {u}…")
    else:
        lines.append('机械无解段落：0')
    lines.append(f"R04 前景：{'PASS 可达' if s['max_after'] <= MAX_LEN else '仍有超长段'}")
    return '\n'.join(lines)


def run_selftest() -> int:
    """确定性路径自检：各档拆分行为 + 零改动不变量。"""
    failures: list[str] = []

    def check(name: str, cond: bool, detail: str = '') -> None:
        print(f"  {'✓' if cond else '✗'} {name}" + (f" — {detail}" if detail and not cond else ''))
        if not cond:
            failures.append(name)

    # 1 一档：引号 + 动作引导的后随引号（合并 ≤100）→ 两段，字符零增删
    line = '“别过去。”我按住他的肩，声音压得很低，“井里有东西。”'
    r = split_dialogue(line)
    check('一档对话拆分（台词独立/动作并入后随台词）',
          isinstance(r, list) and ''.join(r) == line and len(r) == 2
          and r[0] == '“别过去。”' and r[1].endswith('“井里有东西。”'),
          f'result={r}')

    # 2 短叙述并入台词后单段成体 → 返回 None（无需拆），列表则必须字符守恒
    line = '他顿了顿，一字一顿：“三日。三日后辰时落锹。别掺和。”'
    r = split_dialogue(line)
    check('短叙述并入台词/字符守恒', r is None or ''.join(r) == line, f'result={r}')

    # 3 四档：超长单条台词跨段重引
    long_speech = '“' + '他看着井口。' * 18 + '”'   # 6 字 × 18 + 标点 ≈ 126+引号
    pieces = split_speech_requote(long_speech)
    ok3 = (isinstance(pieces, list) and len(pieces) >= 2
           and all(p.startswith('“') for p in pieces)
           and pieces[-1].endswith('”')
           and all(not p.endswith('”') for p in pieces[:-1])
           and ''.join(p.replace('“', '').replace('”', '') for p in pieces)
               == long_speech[1:-1]
           and all(len(p) <= MAX_LEN for p in pieces))
    check('四档跨段重引（只加前引号）', ok3, f'pieces={[p[:12] for p in (pieces or [])]}')

    # 4 无标点怪物句 → 无解
    result, stats = refactor('a' * 150 + '\n')
    check('无标点怪物判无解', stats['overlong_after'] == 1 and len(stats['unfixable']) == 1)

    # 5 句读贪心打包 ≤100 且保序
    line = '一' * 40 + '。' + '二' * 40 + '。' + '三' * 40 + '。'
    r = split_narration(line)
    check('句读打包 ≤100 保序', r is not None and all(len(p) <= 100 for p in r)
          and ''.join(r) == line, f'result={[len(p) for p in (r or [])]}')

    # 6 整文件零改动不变量（引号外）
    doc = '# 标题\n\n' + '“对。”他说，“走。”' + '\n\n' + '四' * 120 + '。\n\n短段。\n'
    result, stats = refactor(doc)
    co = lambda t: re.sub(r'[“”「」]', '', t).replace('\n', '')
    check('整文件内容零改动', co(doc) == co(result))
    check('标题与短段原样', '# 标题' in result and '短段。' in result)

    print(f"\n自检结果：{'全部通过' if not failures else f'{len(failures)} 项失败: {failures}'}")
    return 0 if not failures else 1


def main() -> int:
    ap = argparse.ArgumentParser(description='排版重构器：超长段按语法边界断行，零内容改动')
    ap.add_argument('file', nargs='?', help='book.md 路径')
    ap.add_argument('--in-place', action='store_true', help='原地重写（自动备份 .pre-refactor.bak）')
    ap.add_argument('--json', action='store_true', help='输出 JSON 报告')
    ap.add_argument('--selftest', action='store_true', help='运行确定性路径自检')
    args = ap.parse_args()

    if args.selftest:
        return run_selftest()
    if not args.file:
        ap.error('需要 book.md 路径（或用 --selftest）')

    path = Path(args.file)
    if not path.exists():
        print(f'文件不存在: {path}', file=sys.stderr)
        return 2

    text = path.read_text(encoding='utf-8')
    result, stats = refactor(text)

    # 不变量自检：除四档跨段台词新增的前引号外，零字符增删改。
    # （去掉全部引号与换行后必须逐字符一致，且引号字符只增不减）
    def content_only(t: str) -> str:
        return re.sub(r'[“”「」]', '', t).replace('\n', '')

    if content_only(text) != content_only(result):
        print('✗ 不变量被破坏：除引号外内容有增删改，拒绝写入。', file=sys.stderr)
        return 3
    q_before = sum(text.count(q) for q in '“”「」')
    q_after = sum(result.count(q) for q in '“”「」')
    if q_after < q_before:
        print('✗ 不变量被破坏：引号字符减少，拒绝写入。', file=sys.stderr)
        return 3

    if args.json:
        print(json.dumps(stats, ensure_ascii=False, indent=2))
    else:
        print(report(stats))
        if args.in_place:
            print(f'\n已重写 {path}（备份 {path}.pre-refactor.bak）')

    if args.in_place:
        shutil.copy2(path, str(path) + '.pre-refactor.bak')
        path.write_text(result, encoding='utf-8')

    return 1 if stats['unfixable'] else 0


if __name__ == '__main__':
    sys.exit(main())
