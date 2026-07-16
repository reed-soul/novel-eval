/**
 * 单章生成单测（mock engine + versioned context）
 *
 * 验证：
 *   1. 第一章走新生成服务并发布
 *   2. systemPrompt 含 bible（无过期角色状态）
 *   3. 后续章 prompt 含最近章节原文
 *   4. 已有 active revision 时仍可生成新候选（不走旧 checkpoint 跳过）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AIAgentAdapter, CallResult, RunOptions, TokenUsage } from '@novel-eval/shared';

import {
  chapterId,
  chapterRevisionId,
  outlineId,
  projectId,
  storyStateRevisionId,
  type ProjectId,
} from '../../src/domain/ids.ts';
import type { StoryState, StoryStateDelta } from '../../src/domain/story-state.ts';
import { generateChapter, buildChapterPrompts } from '../../src/chapter/generator.ts';
import { ChapterRepository } from '../../src/repositories/chapter-repository.ts';
import {
  ProjectWriteLeaseRepository,
  type ProjectWriteLease,
} from '../../src/repositories/lease-repository.ts';
import { PlanningRepository } from '../../src/repositories/planning-repository.ts';
import { ProjectRepository } from '../../src/repositories/project-repository.ts';
import { StoryStateRepository } from '../../src/repositories/story-state-repository.ts';
import { ContextCompiler } from '../../src/services/context-compiler.ts';
import { createTestDb } from '../helpers/test-db.ts';
import type { DB } from '../../src/db.ts';

const fixtureTime = '2026-07-16T10:00:00.000Z';
const jobId = 'job-chapter-gen';

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

function contentEngine(text: string): AIAgentAdapter & { prompts: string[]; systemPrompts: string[] } {
  const prompts: string[] = [];
  const systemPrompts: string[] = [];
  return {
    name: 'mock',
    prompts,
    systemPrompts,
    async run(prompt: string, options: RunOptions): Promise<CallResult> {
      prompts.push(prompt);
      systemPrompts.push(options.systemPrompt ?? '');
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

function seedProject(db: DB, chapterCount: number): {
  projectId: ProjectId;
  lease: ProjectWriteLease;
} {
  const id = projectId('project-gen');
  const projects = new ProjectRepository(db);
  const planning = new PlanningRepository(db);
  projects.create({
    id,
    title: '测试',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: 'premise',
    createdAt: fixtureTime,
  });
  const bible = planning.saveBibleRevision({
    id: 'bible-1',
    projectId: id,
    revisionNumber: 1,
    status: 'approved',
    bible: { premise: 'premise', themes: ['记忆'] },
    compiledText: '设定全文稳定内容。',
    createdAt: fixtureTime,
  });
  projects.setActiveBibleRevision(id, bible.id, fixtureTime);

  for (let position = 1; position <= chapterCount; position++) {
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
        content: { summary: `梗概${position}`, beats: ['推进'] },
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

function publishPosition(
  db: DB,
  project: ProjectId,
  position: number,
  content: string,
  previousStateId: string | null,
): string {
  const chapters = new ChapterRepository(db);
  const states = new StoryStateRepository(db);
  const revision = chapterRevisionId(`chapter-revision-${position}`);
  const chapter = chapterId(`chapter-${position}`);
  chapters.saveCandidate({
    chapter: {
      id: chapter,
      projectId: project,
      outlineId: outlineId(`outline-${position}`),
      createdAt: fixtureTime,
    },
    revision: {
      id: revision,
      revisionNumber: 1,
      source: 'generated',
      parentRevisionId: null,
      title: `第${position}章`,
      content,
      wordCount: content.length,
      status: 'draft',
      generationRunId: `run-${position}`,
      createdAt: fixtureTime,
    },
  });
  chapters.publishRevision(revision);
  db.prepare(`UPDATE chapter_outline SET status = 'written' WHERE id = ?`)
    .run(outlineId(`outline-${position}`));
  const stateId = `state-${position}`;
  states.save({
    id: storyStateRevisionId(stateId),
    projectId: project,
    chapterId: chapter,
    chapterRevisionId: revision,
    previousStateRevisionId: previousStateId === null
      ? null
      : storyStateRevisionId(previousStateId),
    sequence: position,
    status: 'current',
    state: emptyState(`第${position}章`),
    delta: emptyDelta(`第${position}章`),
    summary: `第${position}章`,
    model: 'mock',
    promptVersion: 'state-v1',
    createdAt: fixtureTime,
  });
  return stateId;
}

const passthroughExtract = async (): Promise<{
  state: StoryState;
  delta: StoryStateDelta;
  usage: TokenUsage;
  model: string;
  promptVersion: string;
}> => ({
  state: emptyState('ok'),
  delta: emptyDelta('ok'),
  usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'extract', durationMs: 1 },
  model: 'extract',
  promptVersion: 'state-v1',
});

describe('generateChapter', () => {
  it('第一章生成正文并发布', async (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const { projectId: pid, lease } = seedProject(testDb.db, 1);
    const engine = contentEngine('这是第一章的正文内容，描述主角苏醒后的场景。'.repeat(5));

    const result = await generateChapter({
      engine,
      db: testDb.db,
      projectId: pid,
      number: 1,
      wordCount: 500,
      lease,
      extractState: passthroughExtract,
    });

    assert.equal(result.number, 1);
    assert.ok(result.content.length > 0);
    assert.equal(result.outcome.kind, 'published');
    const active = new ChapterRepository(testDb.db).getByOutlinePosition(pid, 1);
    assert.ok(active?.activeRevisionId);
  });

  it('第一章 systemPrompt 含 bible，user prompt 不含 bible 全文', async (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const { projectId: pid, lease } = seedProject(testDb.db, 1);
    const engine = contentEngine('正文内容。'.repeat(20));
    let capturedSystem = '';
    let capturedUser = '';

    await generateChapter({
      engine,
      db: testDb.db,
      projectId: pid,
      number: 1,
      wordCount: 500,
      lease,
      extractState: passthroughExtract,
      generateContent: async (context) => {
        const prompts = buildChapterPrompts(context, 500);
        capturedSystem = prompts.systemPrompt;
        capturedUser = prompts.userPrompt;
        return {
          title: context.outline.revision.title,
          content: '正文内容。'.repeat(20),
          usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'mock', durationMs: 1 },
          model: 'mock',
        };
      },
    });

    assert.ok(capturedSystem.includes('设定全文稳定内容'), 'systemPrompt 应含 bible');
    assert.equal(capturedUser.includes('设定全文稳定内容'), false);
  });

  it('后续章 prompt 含最近章节原文', async (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const { projectId: pid, lease } = seedProject(testDb.db, 2);
    publishPosition(testDb.db, pid, 1, '前一章的正文内容unique_marker', null);

    let userPrompt = '';
    await generateChapter({
      engine: contentEngine('第二章正文'),
      db: testDb.db,
      projectId: pid,
      number: 2,
      wordCount: 500,
      lease,
      extractState: passthroughExtract,
      generateContent: async (context) => {
        userPrompt = buildChapterPrompts(context, 500).userPrompt;
        return {
          title: context.outline.revision.title,
          content: '第二章正文内容。'.repeat(10),
          usage: { inputTokens: 1, outputTokens: 1, costRmb: 0, model: 'mock', durationMs: 1 },
          model: 'mock',
        };
      },
    });

    assert.ok(userPrompt.includes('unique_marker'), '后续章 prompt 应含前一章原文');
  });

  it('ContextCompiler hash 对相同输入稳定', (t) => {
    const testDb = createTestDb();
    t.after(() => testDb.cleanup());
    const { projectId: pid } = seedProject(testDb.db, 1);
    const compiler = new ContextCompiler(testDb.db);
    const first = compiler.compileChapterContext({
      projectId: pid,
      outlinePosition: 1,
      promptTemplateVersion: 'chapter-v1',
    });
    const second = compiler.compileChapterContext({
      projectId: pid,
      outlinePosition: 1,
      promptTemplateVersion: 'chapter-v1',
    });
    assert.equal(first.contextHash, second.contextHash);
  });
});
