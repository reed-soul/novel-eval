import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { structureGate } from '../../src/gates.ts';
import { NEGATIVE_LEXICON } from '../../src/prompts.ts';
import type { NarrationScript } from '@novel-eval/shared';

function mkScript(over: {
  firstKind?: string; lastKind?: string; texts?: string[]; shot?: string;
}): NarrationScript {
  const kinds = over.firstKind ? [over.firstKind, 'turn', 'turn', 'peak', 'turn', over.lastKind ?? 'coda'] : ['hook', 'turn', 'turn', 'peak', 'turn', 'close', 'coda'];
  const texts = over.texts ?? kinds.map((_, i) => `第${i}拍口播测试句，长度合规的样子${i}`);
  const beats = kinds.map((kind, i) => ({
    id: `b${String(i + 1).padStart(3, '0')}`,
    kind: kind as never,
    sentences: [{ id: `s${i + 1}`, text: texts[i] }],
    visual: { prompt: 'cinematic close-up of a vintage sewing machine in dim light'.repeat(2), characterIds: [], shot: (over.shot ?? 'env') as never },
  }));
  return {
    bookId: 't', bookTitle: '测试书', targetMinutes: 30, generatedAt: '',
    characters: [], acts: [{ id: 'a1', name: '悬念建构' }],
    sequences: [{ id: 'q1', actId: 'a1', title: '测试序列', budgetChars: 100, beats }],
  };
}

describe('structureGate', () => {
  it('健康脚本通过（首 hook 末 coda、无禁词、正脸达标；target=0 跳过时长校验）', () => {
    const r = structureGate(mkScript({}), 0);
    assert.equal(r.passed, true, JSON.stringify(r.issues));
    assert.equal(r.stats.hookInFirst, true);
  });

  it('缺 hook 冷开场会被拦', () => {
    const r = structureGate(mkScript({ firstKind: 'turn' }), 0);
    assert.equal(r.passed, false);
    assert.ok(r.issues.some((i) => i.includes('冷开场')));
  });

  it('负向词库命中被拦（然而事情并没有那么简单）', () => {
    const bad = mkScript({});
    bad.sequences[0].beats[1].sentences[0].text = '然而事情并没有这么简单，她开始怀疑一切';
    const r2 = structureGate(bad, 0);
    assert.equal(r2.passed, false);
    assert.ok(r2.issues.some((i) => i.includes('然而事情并没有')));
  });

  it('正脸超配额被拦（>15%）', () => {
    const r = structureGate(mkScript({ shot: 'face' }), 0);
    assert.equal(r.passed, false);
    assert.ok(r.issues.some((i) => i.includes('正脸')));
  });

  it('多 coda 被拦', () => {
    const s = mkScript({});
    s.sequences[0].beats[5].kind = 'coda'; // 两个 coda
    const r = structureGate(s, 30);
    assert.equal(r.passed, false);
    assert.ok(r.issues.some((i) => i.includes('coda')));
  });

  it('负向词库包含已知油腻话术', () => {
    assert.ok(NEGATIVE_LEXICON.includes('注意看'));
    assert.ok(NEGATIVE_LEXICON.includes('细思极恐'));
  });
});
