import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';

const DIMENSION_KEYS = [
  'storyStructure',
  'characterization',
  'writingQuality',
  'emotionalResonance',
  'marketPotential',
  'thematicDepth',
  'originality',
  'pacingRetention',
] as const;

type DimensionKey = typeof DIMENSION_KEYS[number];

interface DimensionDto {
  score: number;
  analysis: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dimensionsFor(keys: readonly DimensionKey[]): Record<string, DimensionDto> {
  const dimensions: Record<string, DimensionDto> = {};
  keys.forEach((key, index) => {
    dimensions[key] = { score: 70 + index, analysis: `${key} analysis` };
  });
  return dimensions;
}

describe('eval report contract', () => {
  const tempRoot = join(tmpdir(), `web-eval-contract-${process.pid}`);
  const evalDataDir = join(tempRoot, 'evals');

  before(() => {
    process.env.EVAL_DATA_DIR = evalDataDir;
    mkdirSync(evalDataDir, { recursive: true });
  });

  after(() => {
    delete process.env.EVAL_DATA_DIR;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  async function fetchEvalResult(taskId: string): Promise<{ status: number; json: unknown }> {
    const { evalTasksRouter } = await import('../../server/routes/eval-tasks.ts');
    const app = new Hono();
    app.route('/api/eval', evalTasksRouter);
    const res = await app.fetch(new Request(`http://test/api/eval/${taskId}/result`));
    return { status: res.status, json: await res.json() };
  }

  it('returns a flat evaluation report DTO with eight dimensions and excerpts', async () => {
    const taskId = 'eight-dimension-report';
    const wrappedReport = {
      task: { id: 'internal-task', status: 'completed' },
      result: {
        schemaVersion: '1.1.0',
        novel: { title: '测书', author: '作者', totalChapters: 1, wordCount: 100 },
        overall: { totalScore: 82, grade: 'A' },
        dimensions: dimensionsFor(DIMENSION_KEYS),
        characters: [],
        emotionalCurve: [],
        excerpts: [
          {
            chapterId: 'chapter-1',
            excerptIndex: 0,
            dimension: 'thematicDepth',
            text: '她终于看懂了这座城的沉默。',
            reason: '主题表达有证据',
            offset: 12,
          },
        ],
        suggestions: [],
      },
    };
    writeFileSync(join(evalDataDir, `${taskId}.json`), JSON.stringify(wrappedReport));

    const report = await fetchEvalResult(taskId);

    assert.equal(report.status, 200);
    assert.ok(isRecord(report.json));
    assert.equal(report.json.task, undefined);
    assert.equal(report.json.result, undefined);
    assert.ok(isRecord(report.json.dimensions));
    for (const key of DIMENSION_KEYS) {
      assert.ok(isRecord(report.json.dimensions[key]), `missing ${key}`);
    }
    assert.ok(Array.isArray(report.json.excerpts));
    assert.equal(report.json.excerpts.length, 1);
  });

  it('rejects incomplete dimension coverage instead of returning a fake full grade', async () => {
    const taskId = 'incomplete-report';
    const incompleteReport = {
      schemaVersion: '1.1.0',
      novel: { title: '缺维度书', author: '作者', totalChapters: 1, wordCount: 100 },
      overall: { totalScore: 95, grade: 'S' },
      dimensions: dimensionsFor(DIMENSION_KEYS.slice(0, 5)),
      characters: [],
      emotionalCurve: [],
      excerpts: [],
      suggestions: [],
    };
    writeFileSync(join(evalDataDir, `${taskId}.json`), JSON.stringify(incompleteReport));

    const report = await fetchEvalResult(taskId);

    assert.equal(report.status, 422);
    assert.ok(isRecord(report.json));
    assert.equal(report.json.code, 'EvaluationIncompleteError');
  });

  it('rejects low evidence link rate even when all dimensions are present', async () => {
    const taskId = 'low-link-rate';
    const reportBody = {
      schemaVersion: '1.1.0',
      novel: { title: '弱证据书', author: '作者', totalChapters: 2, wordCount: 200 },
      overall: { totalScore: 88, grade: 'A' },
      dimensions: dimensionsFor(DIMENSION_KEYS),
      characters: [],
      emotionalCurve: [],
      excerpts: [
        {
          text: '命中',
          dimension: 'writingQuality',
          reason: 'ok',
          chapterId: 'ch001',
          matchedBy: 'exact',
          offset: 1,
        },
        {
          text: '未命中1',
          dimension: 'writingQuality',
          reason: 'bad',
          chapterId: 'ch001',
          matchedBy: 'none',
          offset: null,
        },
        {
          text: '未命中2',
          dimension: 'storyStructure',
          reason: 'bad',
          chapterId: 'ch002',
          matchedBy: 'none',
          offset: null,
        },
        {
          text: '未命中3',
          dimension: 'characterization',
          reason: 'bad',
          chapterId: 'ch002',
          matchedBy: 'none',
          offset: null,
        },
      ],
      suggestions: [],
      task: { chapterCount: 2, sourceWordCount: 200 },
    };
    writeFileSync(join(evalDataDir, `${taskId}.json`), JSON.stringify(reportBody));

    const report = await fetchEvalResult(taskId);
    assert.equal(report.status, 422);
    assert.ok(isRecord(report.json));
    assert.equal(report.json.code, 'EvaluationIncompleteError');
    assert.match(String(report.json.error ?? report.json.message ?? ''), /link rate|incomplete/i);
  });

  it('rejects high chapter skip rate', async () => {
    const taskId = 'high-skip-rate';
    const reportBody = {
      schemaVersion: '1.1.0',
      novel: { title: '跳章书', author: '作者', totalChapters: 10, wordCount: 1000 },
      overall: { totalScore: 90, grade: 'S' },
      dimensions: dimensionsFor(DIMENSION_KEYS),
      characters: [],
      emotionalCurve: [],
      excerpts: [
        {
          text: '命中',
          dimension: 'writingQuality',
          reason: 'ok',
          chapterId: 'ch001',
          matchedBy: 'exact',
          offset: 1,
        },
      ],
      suggestions: [],
      coverage: {
        skippedChapterIds: ['ch001', 'ch002', 'ch003', 'ch004'],
      },
      task: { chapterCount: 10, sourceWordCount: 1000 },
    };
    writeFileSync(join(evalDataDir, `${taskId}.json`), JSON.stringify(reportBody));

    const report = await fetchEvalResult(taskId);
    assert.equal(report.status, 422);
    assert.ok(isRecord(report.json));
    assert.equal(report.json.code, 'EvaluationIncompleteError');
  });
});
