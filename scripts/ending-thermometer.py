#!/usr/bin/env python3
"""结局温度计（final-plan P1-4）：末 900 字四件套逐项定位，零 token 秒级。

spec-gate 的 R07/R08 只给"结局不好"的二元判定；温度计回答"哪一件缺了、
证据在哪一句、怎么补"——修改范围收敛到末段，不重写全书。

四件套（对齐 daily-novel-prompt 第 20 行的定义）：
  ① 罪名点名   每个恶役至少一项具体罪名（"被带走/进了程序"不算）——词表同源 spec-gate.CRIME
  ② 刑罚落地   一句话写完且写明量：判 X 年/无期/死刑/罚金。"数罪并罚"无年限记半分
  ③ 情感落点   末 600 字里有"具体的人 + 具体的动作"的镜头（程序段落不算）
  ④ 人话末句   末句是人说的话/具体动作；禁口号金句、禁"不是X是Y"式哲理收束、禁续集钩

计分：每项 1.0 全过 / 0.5 半过（仅②存在）/ 0 缺失。exit 1 当且仅当任一项为 0。

用法：
  python3 scripts/ending-thermometer.py <book.md> [--tail 900] [--json] [--selftest]
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

# ─── 与 spec-gate.py 单一事实源：词表与正文提取直接复用 ────────────

_SPEC_GATE_PATH = Path(__file__).resolve().parent / 'spec-gate.py'


def _load_spec_gate():
    spec = importlib.util.spec_from_file_location('spec_gate', _SPEC_GATE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


sg = _load_spec_gate()
CRIME = sg.CRIME
PUNISH = sg.PUNISH
SLOGAN = sg.SLOGAN
CONTINUATION_HOOK = sg.CONTINUATION_HOOK
strip_markup = sg.strip_markup

# ─── 温度计自有的校准规则（基于 v3 期真实结局样本调校）─────────────

VAGUE_ONLY = re.compile(r'被带走|被控制|被调查|依法处理|归案|落网|进了程序|移送')
DURATION = re.compile(
    r'[0-9一二三四五六七八九十]{1,3}\s*(?:年|个月)|无期|死刑|死缓|缓刑|'
    r'剥夺政治权利|没收|罚款[一-龢0-9]{1,6}|罚金|行政拘留'
)
PERSON_REF = re.compile(r'我|他|她|奶奶|爷爷|娘|爹|母亲|父亲|孩子|女儿|儿子|阿[一-龢]{1,2}')
ACTION_VERB = re.compile(
    r'抻|抚|握|抱|放下|埋|烧|递|擦|看|望|坐|站|走|回头|点头|说|哭|笑|停|踩|'
    r'织|描|压|展开|摸出|抬起|拨|合上|收起|靠|贴|捡|摆'
)
PROCEDURE = re.compile(r'判决|裁定|判处|罪名|案卷|侦查|移送|程序|伏法|依法|宣判')
ABSTRACT_NOUN = re.compile(r'天理|正义|人心|命运|真相|光明|黑暗|善恶|报应|谎言|希望|未来')
APHORISM = re.compile(r'不是.{1,14}[，。]?.{0,3}是|从来|永远|总会|终将|从不')
SENT_END = re.compile(r'(?<=[。！？…!?])')


def sentences_of(text: str) -> list[str]:
    return [s for s in SENT_END.split(text) if s.strip()]


def evidence(hit: str, sents: list[str], width: int = 56) -> str | None:
    """给出命中词所在句（截断展示）。"""
    for s in sents:
        if hit in s:
            s = s.strip()
            return s if len(s) <= width else s[:width] + '…'
    return None


def check_crime(tail: str, sents: list[str]) -> dict:
    hits = sorted(set(re.findall(CRIME, tail)))
    if hits:
        return {'item': '罪名点名', 'score': 1.0,
                'evidence': evidence(hits[0], sents),
                'note': f'命中：{"、".join(hits)}'}
    vague = sorted(set(VAGUE_ONLY.findall(tail)))
    if vague:
        return {'item': '罪名点名', 'score': 0.0,
                'evidence': evidence(vague[0], sents),
                'note': f'只有模糊处理（{ "、".join(vague) }），无具体罪名——'
                        f'为每个恶役补一项罪名，如"XX因职务侵占罪…"'}
    return {'item': '罪名点名', 'score': 0.0, 'evidence': None,
            'note': '末 900 字零罪名——补一句点名（罪名+人名），不能只写"被带走"'}


def check_punish(tail: str, sents: list[str]) -> dict:
    hits = sorted(set(re.findall(PUNISH, tail)))
    # 刑期必须与刑罚词同句共现，防止"二十三年前"这类背景时长误判为刑期
    dura_with_punish: list[str] = []
    punish_sent: str | None = None
    for s in sents:
        if re.search(PUNISH, s):
            punish_sent = punish_sent or s
            dura_with_punish.extend(DURATION.findall(s))
    if hits and dura_with_punish:
        return {'item': '刑罚落地', 'score': 1.0,
                'evidence': (punish_sent or '').strip()[:56] or None,
                'note': f'刑罚：{"、".join(hits[:3])}；量：{"、".join(sorted(set(dura_with_punish))[:3])}（同句）'}
    if hits:
        return {'item': '刑罚落地', 'score': 0.5,
                'evidence': evidence(hits[0], sents),
                'note': f'有刑罚词（{"、".join(hits[:3])}）但无同句刑期——'
                        f'一句话补"判处有期徒刑X年"式落地（背景年份不算）'}
    return {'item': '刑罚落地', 'score': 0.0, 'evidence': None,
            'note': '零刑罚落地——按"罪名→刑期"一句话写完，不写庭审过程'}


def check_emotion(tail: str, sents: list[str]) -> dict:
    window = tail[-600:]
    wsents = sentences_of(window)
    for s in wsents:
        if PERSON_REF.search(s) and ACTION_VERB.search(s) and not PROCEDURE.search(s):
            return {'item': '情感落点', 'score': 1.0,
                    'evidence': s.strip()[:56] + ('…' if len(s.strip()) > 56 else ''),
                    'note': '人+具体动作镜头已到位'}
    proc = sum(1 for s in wsents if PROCEDURE.search(s))
    if wsents and proc / len(wsents) >= 0.5:
        return {'item': '情感落点', 'score': 0.0, 'evidence': None,
                'note': f'末段被程序性内容占据（{proc}/{len(wsents)} 句）——'
                        f'缺"具体的人+具体动作"的收束镜头，如"我把那把伞放回门后"'}
    return {'item': '情感落点', 'score': 0.0, 'evidence': None,
            'note': '末 600 字无"人+动作"镜头——补一个：一个具体的人，做一个具体动作'}


def check_final_sentence(body: str) -> dict:
    sents = sentences_of(body[-300:])
    if not sents:
        return {'item': '人话末句', 'score': 0.0, 'evidence': None, 'note': '无正文'}
    # 句号切分可能把引号尾巴留成空片段（"…"。→ 末片只剩「"」）：
    # 从尾往回找第一个含汉字的完整句
    last = None
    for s in reversed(sents):
        if re.search(r'[一-龢]', s):
            last = s
            break
    if last is None:
        last = sents[-1]
    last = re.sub(r'\s+', '', last)
    ev = last[:56] + ('…' if len(last) > 56 else '')

    for pat in SLOGAN:
        m = re.findall(pat, last)
        if m:
            return {'item': '人话末句', 'score': 0.0, 'evidence': ev,
                    'note': f'末句命中口号/金句模式（{m[0] if isinstance(m[0], str) else m[0][0]}）——'
                            f'换成一句人话或一个动作'}
    for pat in CONTINUATION_HOOK:
        if re.findall(pat, last):
            return {'item': '人话末句', 'score': 0.0, 'evidence': ev,
                    'note': '末句是续集钩——砍掉，落到本篇内的收束'}
    has_quote = any(q in last for q in '“”「」')
    if APHORISM.search(last) and ABSTRACT_NOUN.search(last) and not has_quote:
        return {'item': '人话末句', 'score': 0.0, 'evidence': ev,
                'note': '末句是"不是X，是Y"式哲理收束（无引语）——'
                        '改成人物说出口的话，或一个具体动作'}
    if PROCEDURE.search(last) and not PERSON_REF.search(last):
        return {'item': '人话末句', 'score': 0.0, 'evidence': ev,
                'note': '末句停在程序（无人称）——换成人物视角的一句话'}
    return {'item': '人话末句', 'score': 1.0, 'evidence': ev, 'note': '末句是人话/具体动作'}


def measure(book_path: str, tail_len: int = 900) -> dict:
    raw = Path(book_path).read_text(encoding='utf-8')
    body = '\n'.join(strip_markup(raw))
    tail = body[-tail_len:]
    sents = sentences_of(tail)
    items = [
        check_crime(tail, sents),
        check_punish(tail, sents),
        check_emotion(tail, sents),
        check_final_sentence(body),
    ]
    temp = sum(i['score'] for i in items)
    return {'book': Path(book_path).name, 'tail_chars': tail_len,
            'items': items, 'temperature': round(temp, 1),
            'hard_fail': any(i['score'] == 0 for i in items)}


def render(res: dict) -> str:
    icons = {1.0: '✓', 0.5: '⚠', 0.0: '✗'}
    lines = [f"── 结局温度计（末 {res['tail_chars']} 字 · 四件套）── 《{res['book']}》"]
    for i, item in enumerate(res['items'], 1):
        mark = icons[item['score']]
        lines.append(f"{'①②③④'[i-1]} {item['item']}　{mark}　{item['note']}")
        if item['evidence']:
            lines.append(f"    证据：「{item['evidence']}」")
    lines.append(f"温度：{res['temperature']}/4"
                 + ('　（有硬缺失，exit 1）' if res['hard_fail'] else '　（四件齐）'))
    return '\n'.join(lines)


def run_selftest() -> int:
    failures: list[str] = []

    def check(name: str, cond: bool, detail: str = '') -> None:
        print(f"  {'✓' if cond else '✗'} {name}" + (f" — {detail}" if detail and not cond else ''))
        if not cond:
            failures.append(name)

    import tempfile, os
    def measure_text(t: str) -> dict:
        with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False, encoding='utf-8') as f:
            f.write(t); p = f.name
        try:
            return measure(p)
        finally:
            os.unlink(p)

    # 1 四件齐：罪名+年限+人动作镜头+引语末句
    good = ('覃广仁伏法。' + '账目一页页核清。' * 10 +
            '最终，覃广仁因职务侵占罪、故意杀人罪被判处有期徒刑二十年。'
            '奶奶坐在坟前，把爷爷那件旧棉袄的领口抻平，轻声说："都到家了。"')
    r = measure_text(good)
    check('四件齐 4/4', r['temperature'] == 4.0 and not r['hard_fail'],
          f"temp={r['temperature']} items={[(i['item'], i['score']) for i in r['items']]}")

    # 2 只有"被带走"式模糊 → ① 0 分
    vague = ('事情过去了。' * 30 + '后来他被带走了，案子进了程序。'
             '我关上门，把那盏灯收了起来。')
    r = measure_text(vague)
    check('模糊处理判 ① 缺失', r['items'][0]['score'] == 0.0)

    # 3 刑罚有词无量 → ② 0.5
    half = ('他落网了。' + '风停了。' * 20 + '法院数罪并罚。'
            '她把那页纸压在坟前的红布底下，说："清了。"')
    r = measure_text(half)
    check('有刑罚无量级记 ② 半分', r['items'][1]['score'] == 0.5,
          f"score={r['items'][1]['score']}")

    # 4 "不是X是Y"哲理末句 → ④ 0 分
    aphor = ('他判了十年。' + '日子一天天过去。' * 15 +
             '她坐在门槛上望着远处。不是天理昭昭，是人心从来不会凉。')
    r = measure_text(aphor)
    check('哲理式末句判 ④ 缺失', r['items'][3]['score'] == 0.0,
          f"note={r['items'][3].get('note')}")

    # 5 引语末句 + 人动作 → ③④ 过
    spoken = ('因诈骗罪获刑八年。' + '院子静了。' * 15 +
              '娘把顶针收进匣子，看了很久，说："睡吧。"')
    r = measure_text(spoken)
    check('引语末句/动作镜头过 ③④', r['items'][2]['score'] == 1.0 and r['items'][3]['score'] == 1.0,
          f"③={r['items'][2]['score']} ④={r['items'][3]['score']}")

    # 6 词表同源完整性
    check('spec-gate 词表已同源加载', bool(CRIME and PUNISH and SLOGAN))

    print(f"\n自检结果：{'全部通过' if not failures else f'{len(failures)} 项失败: {failures}'}")
    return 0 if not failures else 1


def main() -> int:
    ap = argparse.ArgumentParser(description='结局温度计：末 900 字四件套逐项定位')
    ap.add_argument('file', nargs='?', help='book.md 路径')
    ap.add_argument('--tail', type=int, default=900, help='检查窗口字数（默认 900）')
    ap.add_argument('--json', action='store_true', help='输出 JSON')
    ap.add_argument('--selftest', action='store_true', help='运行自检')
    args = ap.parse_args()

    if args.selftest:
        return run_selftest()
    if not args.file:
        ap.error('需要 book.md 路径（或用 --selftest）')
    if not Path(args.file).exists():
        print(f'文件不存在: {args.file}', file=sys.stderr)
        return 2

    res = measure(args.file, args.tail)
    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        print(render(res))
    return 1 if res['hard_fail'] else 0


if __name__ == '__main__':
    sys.exit(main())
