/**
 * generateRange 暂停/取消控制单测
 *
 * 验证：
 *   1. shouldPause 在第 3 章返回 true → 写完 2 章后抛 JobPausedError(3)
 *   2. shouldCancel → 抛 JobCancelledError，已写章节保留
 *   3. onChapterComplete 回调每章触发，记录断点
 *   4. 无 control 时行为与原来一致（全跑完）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AIAgentAdapter, CallResult, RunOptions, TokenUsage } from '@novel-eval/shared';

import type { DB } from '../../src/db.ts';
import {
  outlineId,
  projectId,
  type ProjectId,
} from '../../src/domain/ids.ts';
import type { StoryState, StoryStateDelta } from '../../src/domain/story-state.ts';
import {
  generateRange, JobPausedError, JobCancelledError,
} from '../../src/chapter/generator.ts';
import { ChapterRepository } from '../../src/repositories/chapter-repository.ts';
import {
  ProjectWriteLeaseRepository,
  type ProjectWriteLease,
} from '../../src/repositories/lease-repository.ts';
import { PlanningRepository } from '../../src/repositories/planning-repository.ts';
import { ProjectRepository } from '../../src/repositories/project-repository.ts';
import { createTestDb } from '../helpers/test-db.ts';

const fixtureTime = '2026-07-16T11:00:00.000Z';
const jobId = 'job-range';

function emptyState(summary: string): StoryState {
  return { characters: [], facts: [], foreshadows: [], timeline: [], summary };
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

function contentEngine(text: string): AIAgentAdapter {
  return {
    name: 'mock',
    async run(_prompt: string, _options: RunOptions): Promise<CallResult> {
      return {
        text,
        usage: { inputTokens: 10, outputTokens: 20, costRmb: 0.001, model: 'mock', durationMs: 1 },
        notes: [],
      };
    },
    async isAvailable() { return true; },
  };
}

function seedJob(db: DB, project: ProjectId): void {
  db.prepare(`
    INSERT INTO job (
      id, project_id, type, scope_json, input_json, engine, model, word_count,
      quality_profile, budget_json, prompt_version, status, created_at, updated_at
    ) VALUES (?, ?, 'chapter', '{}', '{}', 'test', 'mock', 500,
      'default', '{}', 'chapter-v1', 'running', ?, ?)
  `).run(jobId, project, fixtureTime, fixtureTime);
}

function seedRange(db: DB, count: number): {
  projectId: ProjectId;
  lease: ProjectWriteLease;
} {
  const id = projectId('project-range');
  const projects = new ProjectRepository(db);
  const planning = new PlanningRepository(db);
  projects.create({
    id,
    title: 'Range',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: 'premise',
    createdAt: fixtureTime,
  });
  const bible = planning.saveBibleRevision({
    id: 'bible-range',
    projectId: id,
    revisionNumber: 1,
    status: 'approved',
    bible: { premise: 'premise' },
    compiledText: '设定全文',
    createdAt: fixtureTime,
  });
  projects.setActiveBibleRevision(id, bible.id, fixtureTime);
  for (let position = 1; position <= count; position++) {
    planning.saveApprovedOutline({
      outline: {
        id: outlineId(`outline-${position}`),
        projectId: id,
        position,
        createdAt: fixtureTime,
        updatedAt: fixtureTime,
      },
      revision: {
        id: `outline-revision-${position}`,
        revisionNumber: 1,
        title: `第${position}章`,
        content: { summary: `梗概${position}`, beats: [] },
        createdAt: fixtureTime,
      },
    });
  }
  seedJob(db, id);
  const lease = new ProjectWriteLeaseRepository(db).acquire({
    projectId: id,
    jobId,
    ownerId: 'worker-1',
    ttlMs: 60 * 60_000,
    now: new Date(),
  });
  return { projectId: id, lease };
}

function countPublishedChapters(db: DB, project: ProjectId): number {
  const chapters = new ChapterRepository(db);
  let count = 0;
  for (let position = 1; position <= 20; position++) {
    const chapter = chapters.getByOutlinePosition(project, position);
    if (chapter?.activeRevisionId) count += 1;
  }
  return count;
}

const extractOk = async (input: {
  content: string;
}): Promise<{
  state: StoryState;
  delta: StoryStateDelta;
  usage: TokenUsage;
  model: string;
  promptVersion: string;
}> => ({
  state: emptyState(input.content.slice(0, 12)),
  delta: emptyDelta(input.content.slice(0, 12)),
  usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'extract', durationMs: 1 },
  model: 'extract',
  promptVersion: 'state-v1',
});

describe('generateRange 暂停/取消控制', () => {
  it('shouldPause：写完 2 章后在第 3 章边界暂停', async (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const { projectId: pid, lease } = seedRange(testDb.db, 5);
    const engine = contentEngine('这是正文内容，描述场景的展开。'.repeat(10));
    const completed: number[] = [];

    await assert.rejects(
      generateRange({
        engine,
        db: testDb.db,
        projectId: pid,
        from: 1,
        to: 5,
        wordCount: 500,
        lease,
        extractState: extractOk,
        control: {
          shouldPause: () => completed.length >= 2,
          onChapterComplete: (n) => completed.push(n),
        },
      }),
      (err: unknown) => {
        assert.ok(err instanceof JobPausedError, '应抛 JobPausedError');
        assert.equal((err as JobPausedError).nextChapter, 3);
        return true;
      },
    );

    assert.equal(countPublishedChapters(testDb.db, pid), 2, '应只写完 2 章');
  });

  it('onChapterComplete：每章写完回调，记录断点章号', async (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const { projectId: pid, lease } = seedRange(testDb.db, 3);
    const engine = contentEngine('正文内容描述。'.repeat(10));
    const completed: number[] = [];

    await generateRange({
      engine,
      db: testDb.db,
      projectId: pid,
      from: 1,
      to: 3,
      wordCount: 500,
      lease,
      extractState: extractOk,
      control: {
        shouldPause: () => completed.length >= 2,
        onChapterComplete: (n) => completed.push(n),
      },
    }).catch((error: unknown) => {
      if (!(error instanceof JobPausedError)) throw error;
    });

    assert.deepEqual(completed, [1, 2], '应回调 2 次（章 1、2）');
  });

  it('shouldCancel：取消信号抛 JobCancelledError，已写章节保留', async (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const { projectId: pid, lease } = seedRange(testDb.db, 4);
    const engine = contentEngine('正文内容描述场景。'.repeat(10));
    let cancelled = false;
    const completed: number[] = [];

    await assert.rejects(
      generateRange({
        engine,
        db: testDb.db,
        projectId: pid,
        from: 1,
        to: 4,
        wordCount: 500,
        lease,
        extractState: extractOk,
        control: {
          shouldCancel: () => cancelled,
          onChapterComplete: (n) => {
            completed.push(n);
            if (n >= 2) cancelled = true;
          },
        },
      }),
      (err: unknown) => {
        assert.ok(err instanceof JobCancelledError, '应抛 JobCancelledError');
        return true;
      },
    );

    assert.deepEqual(completed, [1, 2], '取消前写完 2 章');
    assert.equal(countPublishedChapters(testDb.db, pid), 2, '2 章正文已落盘保留');
  });

  it('无 control：行为与原来一致（全跑完）', async (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const { projectId: pid, lease } = seedRange(testDb.db, 3);
    const engine = contentEngine('正文内容描述场景的展开。'.repeat(10));

    const results = await generateRange({
      engine,
      db: testDb.db,
      projectId: pid,
      from: 1,
      to: 3,
      wordCount: 500,
      lease,
      extractState: extractOk,
    });

    assert.equal(results.length, 3);
    assert.equal(countPublishedChapters(testDb.db, pid), 3);
  });
});
