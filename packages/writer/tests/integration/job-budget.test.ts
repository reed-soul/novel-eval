import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { AIAgentAdapter, CallResult, RunOptions } from '@novel-eval/shared';

import type { DB } from '../../src/db.ts';
import { BudgetExceededError } from '../../src/domain/errors.ts';
import {
  outlineId,
  type OutlineId,
  type ProjectId,
} from '../../src/domain/ids.ts';
import type { StoryState, StoryStateDelta } from '../../src/domain/story-state.ts';
import { getJobRow, createJobRow, updateJobStatus, updateJobUsage, updateJobProgress } from '../../src/job-store.ts';
import { PlanningRepository } from '../../src/repositories/planning-repository.ts';
import { ProjectRepository } from '../../src/repositories/project-repository.ts';
import { WriterApplication } from '../../src/services/writer-application.ts';
import {
  fixtureProjectId,
  fixtureTime,
} from '../helpers/fixtures.ts';
import { createTestDb } from '../helpers/test-db.ts';

const ownerId = 'budget-test-owner';
const fixedNow = new Date('2026-07-16T12:00:00.000Z');

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

function costlyEngine(): AIAgentAdapter {
  return {
    name: 'costly-engine',
    async run(_prompt: string, _options: RunOptions): Promise<CallResult> {
      return {
        text: '章节正文',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          costRmb: 0.001,
          model: 'costly-model',
          durationMs: 1,
        },
        notes: [],
      };
    },
    async isAvailable() { return true; },
  };
}

function seedApprovedOutline(
  db: DB,
  input: { position: number; outlineId: OutlineId; title: string },
): void {
  new PlanningRepository(db).saveApprovedOutline({
    outline: {
      id: input.outlineId,
      projectId: fixtureProjectId,
      position: input.position,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    },
    revision: {
      id: `outline-revision-${input.position}`,
      revisionNumber: 1,
      title: input.title,
      content: { summary: `${input.title}摘要`, beats: ['推进'] },
      createdAt: fixtureTime,
    },
  });
}

function seedProjectWithApprovedRange(db: DB, positions: number[]): WriterApplication {
  new ProjectRepository(db).create({
    id: fixtureProjectId,
    title: 'Budget Novel',
    genreProfile: '玄幻',
    targetAudience: '成人',
    premise: '预算测试',
    createdAt: fixtureTime,
  });
  const planning = new PlanningRepository(db);
  const bible = planning.saveBibleRevision({
    id: 'bible-revision-budget-1',
    projectId: fixtureProjectId,
    revisionNumber: 1,
    status: 'approved',
    bible: { premise: '预算测试' },
    compiledText: '稳定设定。',
    createdAt: fixtureTime,
  });
  new ProjectRepository(db).setActiveBibleRevision(fixtureProjectId, bible.id, fixtureTime);

  for (const position of positions) {
    seedApprovedOutline(db, {
      position,
      outlineId: outlineId(`outline-${position}`),
      title: `第 ${position} 章`,
    });
  }

  return new WriterApplication(db, {
    now: () => fixedNow,
    defaultOwnerId: ownerId,
    leaseTtlMs: 60_000,
  });
}

it('fails the job when cumulative cost exceeds maxCostRmb', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const app = seedProjectWithApprovedRange(testDb.db, [1, 2]);
  const projectId = fixtureProjectId as ProjectId;

  await assert.rejects(
    () => app.generateChapterRange({
      projectId,
      from: 1,
      to: 2,
      wordCount: 1000,
      ownerId: 'test',
      budget: { maxCostRmb: 0.0001 },
      engine: costlyEngine(),
      generateContent: async (context) => ({
        title: context.outline.revision.title,
        content: `正文第${context.outlinePosition}章`,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          costRmb: 0.001,
          model: 'costly-model',
          durationMs: 1,
        },
        model: 'costly-model',
      }),
      extractState: async ({ context }) => ({
        state: emptyState(`状态${context.outlinePosition}`),
        delta: emptyDelta(`状态${context.outlinePosition}`),
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          costRmb: 0,
          model: 'extract',
          durationMs: 1,
        },
        model: 'extract',
        promptVersion: 'state-v1',
      }),
    }),
    BudgetExceededError,
  );

  const jobs = testDb.db.prepare(
    `SELECT id, status, error_type, usage_json FROM job WHERE project_id = ? ORDER BY created_at DESC`,
  ).all(fixtureProjectId) as Array<{
    id: string;
    status: string;
    error_type: string | null;
    usage_json: string | null;
  }>;
  assert.ok(jobs.length >= 1);
  const job = getJobRow(testDb.db, jobs[0].id);
  assert.ok(job);
  assert.equal(job.status, 'failed');
  assert.equal(job.errorType, 'BudgetExceededError');
  assert.ok(job.usage !== null);
});

it('resume continues cumulative usage from persisted usage_json and does not reset the budget', async (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const app = seedProjectWithApprovedRange(testDb.db, [1, 2]);
  const projectId = fixtureProjectId as ProjectId;

  const jobId = createJobRow(testDb.db, {
    projectId,
    type: 'chapter',
    scope: { from: 1, to: 2 },
    engine: 'costly-engine',
    model: 'costly-model',
    wordCount: 1000,
    qualityProfile: 'default',
    promptVersion: 'chapter-v1',
    budget: { maxCostRmb: 0.001 },
    input: { from: 1, to: 2, wordCount: 1000 },
  });
  updateJobUsage(testDb.db, jobId, {
    inputTokens: 10,
    outputTokens: 20,
    costRmb: 0.0015,
    model: 'costly-model',
    durationMs: 1,
  });
  updateJobProgress(testDb.db, jobId, 1);
  updateJobStatus(testDb.db, jobId, 'paused');

  let generateCalls = 0;
  await assert.rejects(
    () => app.generateChapterRange({
      projectId,
      from: 99,
      to: 99,
      wordCount: 9999,
      ownerId: 'test',
      resumeJobId: jobId,
      // Caller override must not open a fresh budget.
      budget: { maxCostRmb: 99 },
      engine: costlyEngine(),
      generateContent: async (context) => {
        generateCalls += 1;
        return {
          title: context.outline.revision.title,
          content: `正文第${context.outlinePosition}章`,
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            costRmb: 0.001,
            model: 'costly-model',
            durationMs: 1,
          },
          model: 'costly-model',
        };
      },
      extractState: async ({ context }) => ({
        state: emptyState(`状态${context.outlinePosition}`),
        delta: emptyDelta(`状态${context.outlinePosition}`),
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          costRmb: 0,
          model: 'extract',
          durationMs: 1,
        },
        model: 'extract',
        promptVersion: 'state-v1',
      }),
    }),
    BudgetExceededError,
  );

  assert.equal(generateCalls, 0, 'must not start the next expensive call under a reset budget');
  const job = getJobRow(testDb.db, jobId);
  assert.ok(job);
  assert.equal(job.status, 'failed');
  assert.equal(job.errorType, 'BudgetExceededError');
});
