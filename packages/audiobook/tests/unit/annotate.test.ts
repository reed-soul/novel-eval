import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotateChapter, DEFAULT_VOICE_CONFIG } from '../../src/annotate.ts';

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
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, 'letter');
  assert.equal(segs[0].rate, '-12%');
});

test('说话人识别：XX说 → 匹配音色表', () => {
  const segs = annotateChapter(1, '测试', '苏野说："我记着呢。"', cfg);
  const d = segs.find((s) => s.kind === 'dialogue');
  assert.ok(d);
  assert.equal(d.voice, 'zh-CN-XiaoyiNeural');
});

test('段落间停顿加长', () => {
  const segs = annotateChapter(1, '测试', '第一段。\n\n第二段。', cfg);
  const last = segs[segs.length - 1];
  assert.ok(last.gapAfterMs >= 650);
});
