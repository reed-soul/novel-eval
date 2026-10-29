/**
 * 亲缘人名锁定单测（battle4 v4-待办④）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractKinshipLocks, formatKinshipLocks, detectKinshipDrift,
} from '../../src/chapter/kinship-lock.ts';

describe('extractKinshipLocks 锁表提取', () => {
  it('叙述式绑定：我爹叫阮长贵', () => {
    const locks = extractKinshipLocks(['我爹叫阮长贵，卖了半辈子豆腐。']);
    assert.ok(locks.some((l) => l.term === '爹' && l.name === '阮长贵'));
  });

  it('紧邻式绑定：我娘王秀兰，', () => {
    const locks = extractKinshipLocks(['我娘王秀兰，走得早。']);
    assert.ok(locks.some((l) => l.term === '娘' && l.name === '王秀兰'));
  });

  it('倒装式绑定：阮长贵是我爹', () => {
    const locks = extractKinshipLocks(['签名底下三个字：阮长贵是我爹。']);
    assert.ok(locks.some((l) => l.name === '阮长贵'));
  });

  it('首现即锁定：后章出现不同名不覆盖', () => {
    const locks = extractKinshipLocks([
      '第一章：我爹叫阮长贵。',
      '第五章：我爹叫阮长福。',   // 历史漂移不进锁表（首现为准）
    ]);
    const die = locks.find((l) => l.term === '爹');
    assert.equal(die?.name, '阮长贵');
  });

  it('多称谓各自独立锁定', () => {
    const locks = extractKinshipLocks(['我爹叫阮长贵，我娘叫王秀兰。']);
    assert.ok(locks.some((l) => l.term === '爹' && l.name === '阮长贵'));
    assert.ok(locks.some((l) => l.term === '娘' && l.name === '王秀兰'));
  });

  it('同位式绑定：阮长贵，我爸的签名 → 建锁 爸=阮长贵（battle4 原句，语义正确）', () => {
    const locks = extractKinshipLocks(['阮长贵，我爸的亲笔签名压在箱底。']);
    const ba = locks.find((l) => l.term === '爸');
    assert.equal(ba?.name, '阮长贵');
  });

  it('误抓防护：孤立的"我爸的签名"（前面无人名）不建锁', () => {
    const locks = extractKinshipLocks(['箱底压着我爸的亲笔签名，纸都脆了。']);
    const ba = locks.find((l) => l.term === '爸');
    assert.equal(ba, undefined);
  });

  it('误抓防护：时间词不当人名（我哥后来…）', () => {
    const locks = extractKinshipLocks(['我哥后来，再没回过村。']);
    const ge = locks.find((l) => l.term === '哥');
    assert.equal(ge, undefined);
  });

  it('firstSeenAt 记录首现章节序', () => {
    const locks = extractKinshipLocks(['无关。', '无关。', '我爹叫阮长贵。']);
    assert.equal(locks.find((l) => l.term === '爹')?.firstSeenAt, 3);
  });
});

describe('formatKinshipLocks 注入文本', () => {
  it('无锁返回空串', () => {
    assert.equal(formatKinshipLocks([]), '');
  });

  it('有锁产出铁律块', () => {
    const s = formatKinshipLocks([{ term: '爹', name: '阮长贵', firstSeenAt: 2 }]);
    assert.ok(s.includes('亲缘人名锁定'));
    assert.ok(s.includes('爹＝阮长贵'));
    assert.ok(s.includes('严禁出现别名'));
  });
});

describe('detectKinshipDrift 漂移检测', () => {
  const locks = extractKinshipLocks(['我爹叫阮长贵，我娘叫王秀兰。']);

  it('同名提及不报', () => {
    assert.equal(detectKinshipDrift('我爹阮长贵坐在门槛上，一言不发。', locks).length, 0);
  });

  it('battle4 实锤场景：锁爹=阮长贵，新章写成别的名 → 违例', () => {
    const drifts = detectKinshipDrift('我爹阮长贵的账本。不，是阮长福，我爹叫阮长福。', locks);
    assert.ok(drifts.length > 0);
    assert.ok(drifts.some((d) => d.term === '爹' && d.expected === '阮长贵' && d.found !== '阮长贵'));
  });

  it('换名紧邻式命中并带证据片段', () => {
    const drifts = detectKinshipDrift('账房里翻出一页纸，我爹阮长福，三个字。', locks);
    const hit = drifts.find((d) => d.term === '爹');
    assert.ok(hit);
    assert.equal(hit?.expected, '阮长贵');
    assert.equal(hit?.found, '阮长福');
    assert.ok(hit?.snippet.includes('阮长福'));
  });

  it('未锁定的称谓不报（新称谓首现合法）', () => {
    const drifts = detectKinshipDrift('我舅舅陈老四，早年跑过船。', locks);
    assert.equal(drifts.length, 0);
  });

  it('其他亲属正常提及不受爹的锁影响', () => {
    assert.equal(detectKinshipDrift('我娘王秀兰的照片泛了黄。', locks).length, 0);
  });
});
