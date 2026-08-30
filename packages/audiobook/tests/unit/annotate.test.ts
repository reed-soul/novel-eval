import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotateChapter, applyPron, truncateAtSentence, DEFAULT_VOICE_CONFIG } from '../../src/annotate.ts';

const cfg = DEFAULT_VOICE_CONFIG;

test('对白与旁白切分：引号内为对白，其余为旁白', () => {
  const text = [
    '挖掘机的钢臂撞上东墙时，张国富正蹲在废钢筋堆上抽烟。',
    '他听见一声闷响，回头看了一眼。',
    '"老周，你还记得那面墙吗？"他问。',
    '周德厚没有说话。',
  ].join('\n\n');
  const segs = annotateChapter(1, '测试', text, cfg);
  const dialogue = segs.filter((s) => s.kind === 'dialogue');
  const narration = segs.filter((s) => s.kind === 'narration');
  assert.equal(dialogue.length, 1);
  assert.equal(dialogue[0].text, '老周，你还记得那面墙吗？');
  assert.ok(narration.length >= 3);
  // 对白与旁白使用不同音色
  assert.notEqual(dialogue[0].voice, narration[0].voice);
});

test('信件段（**…**）识别为 letter 并降低语速', () => {
  const segs = annotateChapter(1, '测试', '**野儿，爸爸对不起你。**', cfg);
  const letters = segs.filter((s) => s.kind === 'letter');
  assert.equal(letters.length, 1);
  assert.equal(letters[0].rate, '-12%');
  // 正文无标题行时自动补读章题（缺头补读，见 cli/annotate 2026-08-26 修订）
  assert.ok(segs.some((s) => s.text === '第一章 测试'));
});

test('说话人识别：XX说 → 匹配音色表', () => {
  // 角色班底走 per-project 配置（data/audiobook/projects/），此处显式传入
  const bookCfg = { ...cfg, voiceBySpeaker: [{ match: '苏野', voice: 'zh-CN-XiaoyiNeural' }] };
  const segs = annotateChapter(1, '测试', '苏野说："我记着呢。"', bookCfg);
  const d = segs.find((s) => s.kind === 'dialogue');
  assert.ok(d);
  assert.equal(d.voice, 'zh-CN-XiaoyiNeural');
});

test('发音表：长词优先、多处命中、未命中原文不动', () => {
  const dict = [
    { match: '98.9', read: '九八年九月' },
    { match: '98.11.20', read: '九八年十一月二十号' },
    { match: '110', read: '幺幺零' },
    { match: '柈子', read: '绊子' },
    { match: '无效', read: '无效' }, // read===match：应被忽略
  ];
  const src = '日期"98.11.20"，另一处 98.9。先打了110。门口堆着柈子。';
  const { text, hits } = applyPron(src, dict);
  assert.equal(text, '日期"九八年十一月二十号"，另一处 九八年九月。先打了幺幺零。门口堆着绊子。');
  // 长词优先：98.11.20 不能被 98.9 咬掉一半
  assert.deepEqual(
    hits.map((h) => h.entry.match),
    ['98.11.20', '98.9', '110', '柈子']
  );
  assert.equal(hits.find((h) => h.entry.match === '110')?.count, 1);
});

test('发音表：空表与无命中为零开销直通', () => {
  assert.equal(applyPron('原文', []).text, '原文');
  const { text, hits } = applyPron('原文', [{ match: '不在场', read: 'X' }]);
  assert.equal(text, '原文');
  assert.equal(hits.length, 0);
});

test('段落间停顿加长', () => {
  const segs = annotateChapter(1, '测试', '第一段。\n\n第二段。', cfg);
  const last = segs[segs.length - 1];
  assert.ok(last.gapAfterMs >= 650);
});

test('truncateAtSentence：优先句终标点收口，半个句子不硬切', () => {
  const text = '第一句完整。第二句很长很长很长很长很长很长很长很长。第三句开始但被截';
  const cut = truncateAtSentence(text, 30);
  assert.ok(cut.length <= 30);
  assert.ok(cut.endsWith('。'), `应收在句号：${cut}`);
  assert.equal(truncateAtSentence('短文', 100), '短文', '不超限不动');
  // 限额内没有任何句读：回退硬切
  const noPunct = '这是一段完全没有句读标记的很长很长的文字内容用于测试硬切行为';
  assert.equal(truncateAtSentence(noPunct, 10), noPunct.slice(0, 10));
});

test('停顿曲线：同段对白连发收紧为 180ms', () => {
  const segs = annotateChapter(1, '测试', '"走。"\n"不走。"', cfg);
  const dialogues = segs.filter((s) => s.kind === 'dialogue');
  assert.equal(dialogues.length, 2);
  assert.equal(dialogues[0].gapAfterMs, 180, '对白→对白应收紧');
});

test('停顿曲线：悬念收尾（省略号旁白）多一拍', () => {
  const flat = annotateChapter(1, '测试', '他消失了。', cfg);
  const suspense = annotateChapter(1, '测试', '他消失了……', cfg);
  const flatLast = flat[flat.length - 1];
  const suspenseLast = suspense[suspense.length - 1];
  assert.ok(suspenseLast.gapAfterMs > flatLast.gapAfterMs, `悬念应更停：${suspenseLast.gapAfterMs} vs ${flatLast.gapAfterMs}`);
});
