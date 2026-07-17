/**
 * CassetteAdapter unit tests — prompt-hash record/replay.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { AIAgentAdapter, CallResult, RunOptions } from '../../src/engine/interface.ts';
import {
  CassetteAdapter,
  CassetteMissError,
  cassettePromptHash,
} from '../../src/engine/cassette.ts';

function countingEngine(text: string): AIAgentAdapter & { calls: number } {
  const engine = {
    name: 'counting',
    calls: 0,
    async run(_userPrompt: string, _options: RunOptions): Promise<CallResult> {
      engine.calls += 1;
      return {
        text,
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          costRmb: 0.001,
          model: 'counting',
          durationMs: 1,
        },
        notes: [],
      };
    },
    async isAvailable() {
      return true;
    },
  };
  return engine;
}

describe('cassettePromptHash', () => {
  it('is stable for identical inputs and changes when prompt changes', () => {
    const a = cassettePromptHash('hello', { systemPrompt: 'sys', temperature: 0.3 });
    const b = cassettePromptHash('hello', { systemPrompt: 'sys', temperature: 0.3 });
    const c = cassettePromptHash('hello!', { systemPrompt: 'sys', temperature: 0.3 });
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(a.length, 64);
  });
});

describe('CassetteAdapter', () => {
  it('records on miss then hits without calling inner again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cassette-'));
    try {
      const inner = countingEngine('{"ok":true}');
      const record = new CassetteAdapter({ mode: 'record', directory: dir, inner });
      const first = await record.run('user-1', { systemPrompt: 'map', temperature: 0.3 });
      assert.equal(first.text, '{"ok":true}');
      assert.equal(inner.calls, 1);

      const second = await record.run('user-1', { systemPrompt: 'map', temperature: 0.3 });
      assert.equal(second.text, '{"ok":true}');
      assert.equal(inner.calls, 1);
      assert.ok(second.notes.some((n) => n.startsWith('cassette:hit:')));

      const replay = new CassetteAdapter({ mode: 'replay', directory: dir });
      const third = await replay.run('user-1', { systemPrompt: 'map', temperature: 0.3 });
      assert.equal(third.text, '{"ok":true}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws CassetteMissError on replay miss', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cassette-miss-'));
    try {
      const replay = new CassetteAdapter({ mode: 'replay', directory: dir });
      await assert.rejects(
        () => replay.run('missing', { systemPrompt: 'x' }),
        (error: unknown) => error instanceof CassetteMissError,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses distinct hashes under concurrent-like different prompts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cassette-conc-'));
    try {
      const inner = countingEngine('resp');
      const adapter = new CassetteAdapter({ mode: 'record', directory: dir, inner });
      await Promise.all([
        adapter.run('chapter-a', { systemPrompt: 'map' }),
        adapter.run('chapter-b', { systemPrompt: 'map' }),
        adapter.run('chapter-a', { systemPrompt: 'map' }),
      ]);
      assert.equal(inner.calls, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
