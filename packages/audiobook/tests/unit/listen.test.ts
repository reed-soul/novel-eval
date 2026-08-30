/**
 * 审听纯函数：CER 归一与编辑距离、ASR 行落窗、段内字幕重对齐。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normForCer, levenshtein, cerOf, cerInHaystack, linesInWindow, realignSegmentCues, type AsrLine } from '../../src/listen.ts';

test('normForCer：只留汉字字母数字，小写，去标点空白', () => {
  assert.equal(normForCer('「六点三十分。」汽笛响了。'), '6点30分汽笛响了');
  assert.equal(normForCer('QL-96-014 合同'), 'ql96014合同');
});

test('normForCer：繁简归一——whisper 繁体输出不算错', () => {
  assert.equal(normForCer('灰塵還沒散進，他看見司機從駕駛室裡出來'), normForCer('灰尘还没散进，他看见司机从驾驶室里出来'));
});

test('normForCer：中文数字归一——一九九八年 vs 1998年 不算错', () => {
  assert.equal(normForCer('一九九八年十二月'), normForCer('1998年12月'));
  assert.equal(normForCer('第二章 十二点四十分'), normForCer('第2章 12点40分'));
  assert.equal(normForCer('两百'), normForCer('200'));
  // 非数字语境同规处理，不破坏汉字比对
  assert.equal(normForCer('一路平安'), normForCer('1路平安'));
});

test('levenshtein：基础距离', () => {
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('幺幺零', '一百一十'), 4);
});

test('cerOf：错读量化——发音表替换后的幺幺零 被读成一百一十应显著>0', () => {
  // 生产形态：发音表已把 110 替换为「幺幺零」（幺非中文数字，保值归一不吞差异）
  const cer = cerOf('先打了幺幺零。', '先打了一百一十');
  assert.ok(cer > 0.3, `cer=${cer}`);
  assert.equal(cerOf('完全一致的话', '完全一致的话'), 0);
});

test('cerInHaystack：半全局对齐——吞行伪影里能滑到本段文字就不算错', () => {
  // whisper 一行吞了三段：s33+s34+s35 的文字全在一行里
  const merged = '老周已经把那块布从植骨尖取出来了。是一截枕巾。准确说是半截。棉布的，发黄发脆。';
  assert.ok(cerInHaystack('老周已经把那块布从指骨间取出来了。', merged) <= 0.25); // 指骨间/植骨尖 近音误差
  assert.ok(cerInHaystack('准确说是半截。棉布的，发黄发脆', merged) <= 0.1);
  assert.ok(Number.isFinite(cerInHaystack('完全无关的话', merged)));
  assert.ok(cerInHaystack('完全无关的话', merged) > 0.5);
  // haystack 过短
  assert.equal(cerInHaystack('长长的话', '短'), Number.POSITIVE_INFINITY);
});

test('linesInWindow：≥50% 落窗归属，骑跨行归重叠多的一侧', () => {
  const lines: AsrLine[] = [
    { startMs: 0, endMs: 1000, text: 'a' },      // 全在窗1
    { startMs: 1500, endMs: 2600, text: 'b' },   // 600/1100=55% 在窗2 [2000,4000]
    { startMs: 3900, endMs: 5000, text: 'c' },   // 骑跨窗2/窗3，1000/1100=91% 在窗3
  ];
  assert.deepEqual(linesInWindow(lines, 0, 2000).map((l) => l.text), ['a']);
  assert.deepEqual(linesInWindow(lines, 2000, 4000).map((l) => l.text), ['b']);
  assert.deepEqual(linesInWindow(lines, 4000, 6000).map((l) => l.text), ['c']);
  assert.deepEqual(linesInWindow(lines, 7000, 8000).map((l) => l.text), []);
});

test('realignSegmentCues：有 ASR 行时摊到实测跨度；无行退回名义窗口', () => {
  const segText = '第一句话。第二句比较长一些。';
  const lines: AsrLine[] = [
    { startMs: 1000, endMs: 2100, text: '第一句话' },
    { startMs: 2200, endMs: 3600, text: '第二句比较长一些' },
  ];
  const cues = realignSegmentCues(segText, lines, 0, 5000);
  assert.equal(cues.length, 2);
  // 实测跨度 [1000,3600]：两 cue 均不得越界，且首 cue 起点被拉到 1000
  assert.equal(cues[0].startMs, 1000);
  assert.ok(cues[1].endMs <= 3600);
  assert.ok(cues[1].endMs > 3000);

  const fallback = realignSegmentCues(segText, [], 0, 5000);
  assert.equal(fallback.length, 2);
  assert.equal(fallback[0].startMs, 0);
});
