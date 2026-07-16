/**
 * API 路由单测 — 章节只返回 active published revision；生成经 WriterApplication
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';

import {
  openDb,
  closeDb,
  createProject,
  outlineId,
  chapterId,
  chapterRevisionId,
  storyStateRevisionId,
  projectId,
  type DB,
  type StoryState,
  type StoryStateDelta,
  ChapterRepository,
  PlanningRepository,
  StoryStateRepository,
  type WriterApplication,
  type GenerateChapterRangeResult,
  type GenerateBibleResult,
  type GenerateBlueprintResult,
} from '@novel-eval/writer';
import { projectRoutes } from '../../server/routes/projects.ts';
import { chapterRoutes } from '../../server/routes/chapters.ts';
import { outlineRoutes } from '../../server/routes/outlines.ts';
import { generateRoutes } from '../../server/routes/generate.ts';
import { EngineRegistry } from '../../server/engine-registry.ts';

const fixtureTime = '2026-07-16T09:00:00.000Z';
const __dirname = dirname(fileURLToPath(import.meta.url));

let tempRoot: string;
let db: DB;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'web-test-'));
  db = openDb({ path: join(tempRoot, 'writer.db') });
});
afterEach(() => {
  closeDb(db);
  rmSync(tempRoot, { recursive: true, force: true });
});

function testApp(database: DB) {
  const app = new Hono();
  app.route('/api/projects', projectRoutes(database));
  app.route('/api/projects', chapterRoutes(database));
  app.route('/api/projects', outlineRoutes(database));
  return app;
}

async function fetchJson(app: Hono, path: string): Promise<{ status: number; json: unknown }> {
  const res = await app.fetch(new Request(`http://test${path}`));
  const json = await res.json();
  return { status: res.status, json };
}

function emptyState(summary: string): StoryState {
  return {
    characters: [],
    facts: [],
    foreshadows: [],
    timeline: [],
    summary,
  };
}

function emptyDelta(summary: string): StoryStateDelta {
  return {
    characterChanges: [],
    factChanges: [],
    foreshadowChanges: [],
    timelineEvents: [],
    summary,
  };
}

function seedOutline(database: DB, rawProjectId: string, position: number, title: string): void {
  const id = projectId(rawProjectId);
  new PlanningRepository(database).saveApprovedOutline({
    outline: {
      id: outlineId(`outline-${rawProjectId}-${position}`),
      projectId: id,
      position,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    },
    revision: {
      id: `outline-revision-${rawProjectId}-${position}`,
      revisionNumber: 1,
      title,
      content: {
        summary: `${title}摘要摘要摘要摘要摘要摘要摘要摘要`,
        beats: ['铺垫'],
        act: 1,
        role: '引入',
        purpose: '开篇介绍主角和核心矛盾冲突',
        suspenseLevel: 5,
        foreshadowing: position === 1 ? '埋设：项链' : '无',
        twistLevel: 1,
        beatLabel: position === 1 ? '铺垫' : '推进',
      },
      createdAt: fixtureTime,
    },
  });
}

function publishChapter(
  database: DB,
  rawProjectId: string,
  position: number,
  title: string,
  content: string,
  previousStateRevisionId: ReturnType<typeof storyStateRevisionId> | null,
): { chapterRevisionId: ReturnType<typeof chapterRevisionId>; chapterId: ReturnType<typeof chapterId> } {
  const id = projectId(rawProjectId);
  const oid = outlineId(`outline-${rawProjectId}-${position}`);
  const cid = chapterId(`chapter-${rawProjectId}-${position}`);
  const rid = chapterRevisionId(`chapter-revision-${rawProjectId}-${position}`);
  const sid = storyStateRevisionId(`state-revision-${rawProjectId}-${position}`);
  const chapters = new ChapterRepository(database);
  const states = new StoryStateRepository(database);
  chapters.saveCandidate({
    chapter: {
      id: cid,
      projectId: id,
      outlineId: oid,
      createdAt: fixtureTime,
    },
    revision: {
      id: rid,
      revisionNumber: 1,
      source: 'generated',
      parentRevisionId: null,
      title,
      content,
      wordCount: content.length,
      status: 'draft',
      generationRunId: `run-${position}`,
      createdAt: fixtureTime,
    },
  });
  chapters.publishRevision(rid);
  database.prepare(`
    UPDATE chapter_outline SET status = 'written', updated_at = ? WHERE id = ?
  `).run(fixtureTime, oid);
  const summary = `状态-${position}`;
  states.save({
    id: sid,
    projectId: id,
    chapterId: cid,
    chapterRevisionId: rid,
    previousStateRevisionId,
    sequence: position,
    status: 'current',
    state: emptyState(summary),
    delta: emptyDelta(summary),
    summary,
    model: 'seed-model',
    promptVersion: 'state-v1',
    createdAt: fixtureTime,
  });
  return { chapterRevisionId: rid, chapterId: cid };
}

describe('API 路由', () => {
  it('GET /api/projects 返回项目列表', async () => {
    createProject(db, { title: '测试书', genreProfile: '科幻', targetAudience: '青年', premise: '测试' });
    const app = testApp(db);
    const { status, json } = await fetchJson(app, '/api/projects');
    assert.equal(status, 200);
    const projects = json as Array<{ title: string }>;
    assert.equal(projects.length, 1);
    assert.equal(projects[0].title, '测试书');
  });

  it('GET /api/projects/:id 返回详情含进度统计', async () => {
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    const app = testApp(db);
    const { status, json } = await fetchJson(app, `/api/projects/${p.id}`);
    assert.equal(status, 200);
    const detail = json as { title: string; outlineCount: number; chapterCount: number };
    assert.equal(detail.title, 'T');
    assert.equal(detail.outlineCount, 0);
    assert.equal(detail.chapterCount, 0);
  });

  it('GET /api/projects/:id/chapters 只反映 active published revision', async () => {
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedOutline(db, p.id, 1, '第一章');
    seedOutline(db, p.id, 2, '第二章');
    const published = publishChapter(db, p.id, 1, '第一章', '正式发布正文', null);

    // 追加一份 draft candidate，不得出现在 GET 响应中
    const chapters = new ChapterRepository(db);
    chapters.appendCandidate({
      chapterId: published.chapterId,
      revision: {
        id: chapterRevisionId(`draft-${p.id}-1`),
        revisionNumber: 2,
        source: 'manual',
        parentRevisionId: published.chapterRevisionId,
        title: '草稿标题',
        content: '草稿正文不得出现',
        wordCount: 8,
        status: 'draft',
        generationRunId: null,
        createdAt: fixtureTime,
      },
    });

    const app = testApp(db);
    const { status, json } = await fetchJson(app, `/api/projects/${p.id}/chapters`);
    assert.equal(status, 200);
    const result = json as {
      chapters: Array<{
        number: number;
        written: boolean;
        title: string;
        activeRevisionId: string | null;
        contentPreview?: string;
      }>;
      total: number;
      written: number;
    };
    assert.equal(result.total, 2);
    assert.equal(result.written, 1);
    assert.equal(result.chapters[0].written, true);
    assert.equal(result.chapters[0].activeRevisionId, published.chapterRevisionId);
    assert.equal(result.chapters[0].title, '第一章');
    assert.equal(result.chapters[1].written, false);
    assert.equal(result.chapters[1].activeRevisionId, null);
  });

  it('GET /api/projects/:id/chapters/:n 返回 active published 正文，忽略 draft', async () => {
    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedOutline(db, p.id, 1, '第一章');
    const published = publishChapter(db, p.id, 1, '第一章', '这是正文内容。', null);
    new ChapterRepository(db).appendCandidate({
      chapterId: published.chapterId,
      revision: {
        id: chapterRevisionId(`draft-single-${p.id}`),
        revisionNumber: 2,
        source: 'manual',
        parentRevisionId: published.chapterRevisionId,
        title: '草稿',
        content: '草稿不得返回',
        wordCount: 6,
        status: 'draft',
        generationRunId: null,
        createdAt: fixtureTime,
      },
    });

    const app = testApp(db);
    const { status, json } = await fetchJson(app, `/api/projects/${p.id}/chapters/1`);
    assert.equal(status, 200);
    const ch = json as {
      content: string;
      outline: { role: string };
      written: boolean;
      wordCount: number;
      activeRevisionId: string;
    };
    assert.equal(ch.content, '这是正文内容。');
    assert.notEqual(ch.content, '草稿不得返回');
    assert.equal(ch.written, true);
    assert.equal(ch.outline.role, '引入');
    assert.equal(ch.wordCount, '这是正文内容。'.length);
    assert.equal(ch.activeRevisionId, published.chapterRevisionId);
  });

  it('GET 不存在的项目返回 404', async () => {
    const app = testApp(db);
    const { status } = await fetchJson(app, '/api/projects/nonexistent-id');
    assert.equal(status, 404);
  });

  it('GET /api/projects/:id/export 导出项目（txt / zip）', async () => {
    const p = createProject(db, { title: '测试导出书', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedOutline(db, p.id, 1, '第一章 启程');
    seedOutline(db, p.id, 2, '第二章 到达');
    publishChapter(db, p.id, 1, '第一章 启程', '内容一', null);
    publishChapter(
      db,
      p.id,
      2,
      '第二章 到达',
      '内容二',
      storyStateRevisionId(`state-revision-${p.id}-1`),
    );

    const app = testApp(db);

    const resTxt = await app.fetch(new Request(`http://test/api/projects/${p.id}/export?format=merge-txt`));
    assert.equal(resTxt.status, 200);
    assert.equal(resTxt.headers.get('Content-Type')?.split(';')[0], 'text/plain');
    const txt = await resTxt.text();
    assert.ok(txt.includes('测试导出书'));
    assert.ok(txt.includes('第一章 启程'));
    assert.ok(txt.includes('内容一'));
    assert.ok(txt.includes('内容二'));

    const resZip = await app.fetch(new Request(`http://test/api/projects/${p.id}/export?format=zip-txt`));
    assert.equal(resZip.status, 200);
    assert.equal(resZip.headers.get('Content-Type'), 'application/zip');
    const zipBuf = await resZip.arrayBuffer();
    assert.ok(zipBuf.byteLength > 100);
  });

  it('rejects generate bodies with negative from/to as ValidationError', async () => {
    const registry = new EngineRegistry(
      {
        mock: {
          name: 'mock',
          provider: 'openai',
          model: 'm',
          baseUrl: 'http://localhost',
          apiKeyEnv: 'NONE',
        },
      },
      'mock',
    );
    const app = new Hono();
    app.route('/api/projects', generateRoutes(db, registry));

    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedOutline(db, p.id, 1, '第一章');

    const res = await app.fetch(new Request(`http://test/api/projects/${p.id}/chapters/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: -1, to: 2 }),
    }));
    assert.equal(res.status, 400);
    const body = await res.json() as { code: string };
    assert.equal(body.code, 'ValidationError');
  });

  it('eval result API returns stable EvaluationReportResponse DTO, not {task,result} wrapper', async () => {
    const { mkdirSync, writeFileSync, rmSync: rm } = await import('node:fs');
    const { join: pathJoin } = await import('node:path');
    const { evalTasksRouter } = await import('../../server/routes/eval-tasks.ts');

    const evalsDir = pathJoin(process.cwd(), 'data', 'evals');
    mkdirSync(evalsDir, { recursive: true });
    const taskId = 'dto-shape-task';
    const nestedLeak = {
      task: { id: 'internal-task', status: 'completed' },
      result: {
        schemaVersion: '1.1.0',
        novel: { title: '测书', author: '作者', totalChapters: 1, wordCount: 100 },
        overall: { totalScore: 80, grade: 'A' },
        dimensions: {
          storyStructure: { score: 80, analysis: 'ok' },
          characterization: { score: 80, analysis: 'ok' },
          writingQuality: { score: 80, analysis: 'ok' },
          emotionalResonance: { score: 80, analysis: 'ok' },
          marketPotential: { score: 80, analysis: 'ok' },
        },
        chapters: [],
        characters: [],
        emotionalCurve: [],
        excerpts: [],
        suggestions: [],
      },
    };
    writeFileSync(pathJoin(evalsDir, `${taskId}.json`), JSON.stringify(nestedLeak));

    try {
      const app = new Hono();
      app.route('/api/eval', evalTasksRouter);
      const res = await app.fetch(new Request(`http://test/api/eval/${taskId}/result`));
      assert.equal(res.status, 200);
      const body = await res.json() as Record<string, unknown>;
      // Stable flat report DTO — not the evaluate() { task, result } envelope
      assert.ok(body.overall, 'expected flat overall');
      assert.ok(body.novel, 'expected flat novel');
      assert.ok(body.dimensions, 'expected flat dimensions');
      assert.equal('result' in body, false, 'must not leak {task,result} wrapper');
      const overall = body.overall as { totalScore: number; grade: string };
      assert.equal(overall.grade, 'A');
      assert.equal(overall.totalScore, 80);
    } finally {
      rm(pathJoin(evalsDir, `${taskId}.json`), { force: true });
    }
  });

  it('generate 路由仅经 WriterApplication facade，不直写 SQL / 旧 store upsert', async () => {
    const generateSrc = readFileSync(
      join(__dirname, '../../server/routes/generate.ts'),
      'utf8',
    );
    assert.doesNotMatch(generateSrc, /\bdb\.prepare\b/);
    assert.doesNotMatch(generateSrc, /\bsaveChapter\b/);
    assert.doesNotMatch(generateSrc, /\bgenerateRange\b/);
    assert.doesNotMatch(generateSrc, /\bensureChapterConsistency\b/);
    assert.match(generateSrc, /WriterApplication|generateChapterRange|generateBible|generateBlueprint/);

    const calls: string[] = [];
    const spyApp = {
      async generateBible(): Promise<GenerateBibleResult> {
        calls.push('generateBible');
        return {
          bible: {
            coreSeed: { premise: 'p' },
            characterDynamics: [],
            characterState: { characters: [] },
            worldBuilding: {
              physical: { elements: [], tensions: [] },
              social: { elements: [], tensions: [] },
              metaphorical: { elements: [], tensions: [] },
            },
            plotArchitecture: {
              act1: { setup: '', conflicts: [], climax: '' },
              act2: { setup: '', conflicts: [], climax: '' },
              act3: { setup: '', conflicts: [], climax: '' },
              foreshadows: [],
            },
            fullText: 'bible',
          },
          bibleRevisionId: 'bible-revision-spy',
          usage: { inputTokens: 0, outputTokens: 0, costRmb: 0, model: 'm', durationMs: 0 },
        };
      },
      async generateBlueprint(): Promise<GenerateBlueprintResult> {
        calls.push('generateBlueprint');
        return {
          outlines: [],
          usage: { inputTokens: 0, outputTokens: 0, costRmb: 0, model: 'm', durationMs: 0 },
        };
      },
      assertChapterPlanningApproved(): void {
        calls.push('assertChapterPlanningApproved');
      },
      async generateChapterRange(): Promise<GenerateChapterRangeResult> {
        calls.push('generateChapterRange');
        return { jobId: 'spy-job', outcomes: [] };
      },
    } as unknown as WriterApplication;

    const registry = new EngineRegistry(
      {
        mock: {
          name: 'mock',
          provider: 'openai',
          model: 'm',
          baseUrl: 'http://localhost',
          apiKeyEnv: 'NONE',
        },
      },
      'mock',
    );
    const app = new Hono();
    app.route('/api/projects', generateRoutes(db, registry, spyApp));

    const p = createProject(db, { title: 'T', genreProfile: 'g', targetAudience: 'a', premise: 't' });
    seedOutline(db, p.id, 1, '第一章');

    const bibleRes = await app.fetch(new Request(`http://test/api/projects/${p.id}/bible/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    assert.equal(bibleRes.status, 200);

    const chapterRes = await app.fetch(new Request(`http://test/api/projects/${p.id}/chapters/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 1, to: 1 }),
    }));
    assert.equal(chapterRes.status, 200);

    // 等后台 runner 调度
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(calls.includes('generateBible'), `expected generateBible, got ${calls.join(',')}`);
    assert.ok(calls.includes('generateChapterRange'), `expected generateChapterRange, got ${calls.join(',')}`);
  });
});
