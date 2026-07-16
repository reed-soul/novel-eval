import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';

import {
  closeDb,
  createProject,
  openDb,
  outlineId,
  PlanningRepository,
  projectId,
  type DB,
} from '@novel-eval/writer';
import { EngineRegistry } from '../../server/engine-registry.ts';
import { bibleRoutes } from '../../server/routes/bible.ts';
import { generateRoutes } from '../../server/routes/generate.ts';
import { outlineRoutes } from '../../server/routes/outlines.ts';

const fixtureTime = '2026-07-16T09:00:00.000Z';

let tempRoot: string;
let db: DB;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'web-planning-approval-'));
  db = openDb({ path: join(tempRoot, 'writer.db') });
});

afterEach(() => {
  closeDb(db);
  rmSync(tempRoot, { recursive: true, force: true });
});

function registry(): EngineRegistry {
  return new EngineRegistry(
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
}

function app(database: DB): Hono {
  const hono = new Hono();
  hono.route('/api/projects', bibleRoutes(database));
  hono.route('/api/projects', outlineRoutes(database));
  hono.route('/api/projects', generateRoutes(database, registry()));
  return hono;
}

function seedDraftPlanning(database: DB): { projectId: string; bibleRevisionId: string } {
  const project = createProject(database, {
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: '林晚追查一张失踪的车票。',
  });
  const id = projectId(project.id);
  const planning = new PlanningRepository(database);
  const bible = planning.saveDraftBibleRevision({
    id: 'bible-draft-1',
    projectId: id,
    revisionNumber: 1,
    status: 'draft',
    bible: {
      fullText: '稳定设定。',
      characterState: { characters: [] },
      plotArchitecture: {
        act1: { setup: '起', conflicts: ['疑点', '阻碍'], climax: '转折' },
        act2: { setup: '承', conflicts: ['追查', '误导'], climax: '低谷' },
        act3: { setup: '合', conflicts: ['揭露', '代价'], climax: '解决' },
        foreshadows: [],
      },
    },
    compiledText: '稳定设定。',
    createdAt: fixtureTime,
  });
  const oid = outlineId('outline-draft-1');
  database.prepare(`
    INSERT INTO chapter_outline (id, project_id, position, status, active_revision_id, created_at, updated_at)
    VALUES (?, ?, 1, 'draft', NULL, ?, ?)
  `).run(oid, id, fixtureTime, fixtureTime);
  database.prepare(`
    INSERT INTO chapter_outline_revision (id, outline_id, revision_number, status, title, content_json, created_at)
    VALUES (?, ?, 1, 'draft', ?, ?, ?)
  `).run(
    'outline-revision-draft-1',
    oid,
    '第 1 章',
    JSON.stringify({ summary: '第一章摘要', beats: ['推进'] }),
    fixtureTime,
  );
  database.prepare(
    'UPDATE chapter_outline SET active_revision_id = ? WHERE id = ?',
  ).run('outline-revision-draft-1', oid);
  return { projectId: project.id, bibleRevisionId: bible.id };
}

describe('planning approval routes', () => {
  it('approves draft bible and outlines through project-scoped endpoints', async () => {
    const seeded = seedDraftPlanning(db);
    const api = app(db);

    const bibleRes = await api.fetch(new Request(
      `http://test/api/projects/${seeded.projectId}/bible-revisions/${seeded.bibleRevisionId}/approve`,
      { method: 'POST' },
    ));
    assert.equal(bibleRes.status, 200);
    const active = new PlanningRepository(db).getActiveBibleForProject(projectId(seeded.projectId));
    assert.equal(active?.id, seeded.bibleRevisionId);
    assert.equal(active?.status, 'approved');

    const outlinesRes = await api.fetch(new Request(
      `http://test/api/projects/${seeded.projectId}/outlines/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 1, to: 1 }),
      },
    ));
    assert.equal(outlinesRes.status, 200);
    const outline = new PlanningRepository(db).getApprovedOutlineAtPosition(
      projectId(seeded.projectId),
      1,
    );
    assert.equal(outline?.outline.status, 'approved');
    assert.equal(outline?.revision.status, 'approved');
  });

  it('rejects chapter generation before bible and outline approval', async () => {
    const seeded = seedDraftPlanning(db);
    const api = app(db);

    const res = await api.fetch(new Request(
      `http://test/api/projects/${seeded.projectId}/chapters/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 1, to: 1, engineName: 'mock' }),
      },
    ));

    assert.equal(res.status, 400);
    const body = await res.json() as { error?: string };
    assert.match(body.error ?? '', /not approved|未批准/i);
  });
});
