import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseArgs } from '../../src/index.ts';

describe('parseArgs write auto', () => {
  it('parses --word-count for auto', () => {
    const args = parseArgs([
      'node',
      'cli.ts',
      'write',
      'auto',
      '--title', '烟测',
      '--genre', '都市',
      '--audience', '青年',
      '--topic', '暴雨',
      '--chapters', '3',
      '--word-count', '1200',
      '--approve-planning',
      '-y',
    ]);
    assert.equal(args.command, 'auto');
    if (args.command !== 'auto') return;
    assert.equal(args.wordCount, 1200);
    assert.equal(args.chapters, 3);
    assert.equal(args.approvePlanning, true);
  });

  it('leaves wordCount undefined when omitted', () => {
    const args = parseArgs([
      'node',
      'cli.ts',
      'auto',
      '--title', '烟测',
      '--genre', '都市',
      '--audience', '青年',
      '--topic', '暴雨',
    ]);
    assert.equal(args.command, 'auto');
    if (args.command !== 'auto') return;
    assert.equal(args.wordCount, undefined);
  });

  it('parses --platform douban for auto', () => {
    const args = parseArgs([
      'node',
      'cli.ts',
      'write',
      'auto',
      '--title', '烟测',
      '--genre', '都市',
      '--audience', '青年',
      '--topic', '暴雨',
      '--platform', 'douban',
      '--chapters', '3',
      '--approve-planning',
      '-y',
    ]);
    assert.equal(args.command, 'auto');
    if (args.command !== 'auto') return;
    assert.equal(args.platform, 'douban');
  });

  it('rejects unknown --platform', () => {
    assert.throws(
      () => parseArgs([
        'node', 'cli.ts', 'init',
        '--title', '烟测', '--genre', '都市', '--audience', '青年', '--topic', '暴雨',
        '--platform', 'zhihu',
      ]),
      /未知平台/,
    );
  });
});
