import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it } from 'node:test';

import {
  chapterId,
  chapterRevisionId,
  outlineId,
  storyStateRevisionId,
} from '../../src/domain/ids.ts';
import { ChapterRepository } from '../../src/repositories/chapter-repository.ts';
import { PlanningRepository } from '../../src/repositories/planning-repository.ts';
import { ProjectRepository } from '../../src/repositories/project-repository.ts';
import { StoryStateRepository } from '../../src/repositories/story-state-repository.ts';
import { ContextCompiler } from '../../src/services/context-compiler.ts';
import {
  fixtureChapterId,
  fixtureChapterRevisionId,
  fixtureOutlineId,
  fixtureProjectId,
  fixtureStateRevisionId,
  fixtureStoryState,
  fixtureStoryStateDelta,
  fixtureTime,
} from '../helpers/fixtures.ts';
import { createTestDb } from '../helpers/test-db.ts';

const mutableCharacterSnippet = '林晚当前状态：左手受伤，人在北站售票厅。';

function seedFoundation(db: ReturnType<typeof createTestDb>['db']): {
  compiler: ContextCompiler;
  chapters: ChapterRepository;
  states: StoryStateRepository;
} {
  const projects = new ProjectRepository(db);
  const planning = new PlanningRepository(db);
  const chapters = new ChapterRepository(db);
  const states = new StoryStateRepository(db);

  projects.create({
    id: fixtureProjectId,
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: '林晚追查一张失踪的车票。',
    createdAt: fixtureTime,
  });

  const bible = planning.saveBibleRevision({
    id: 'bible-revision-1',
    projectId: fixtureProjectId,
    revisionNumber: 1,
    status: 'approved',
    bible: {
      premise: '林晚追查一张失踪的车票。',
      themes: ['记忆'],
      characterState: {
        characters: [{ name: '林晚', status: mutableCharacterSnippet }],
      },
    },
    compiledText: `稳定设定。\n${mutableCharacterSnippet}\n世界规则：车票可改写记忆。`,
    createdAt: fixtureTime,
  });
  projects.setActiveBibleRevision(fixtureProjectId, bible.id, fixtureTime);

  planning.saveApprovedOutline({
    outline: {
      id: fixtureOutlineId,
      projectId: fixtureProjectId,
      position: 1,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    },
    revision: {
      id: 'outline-revision-1',
      revisionNumber: 1,
      title: '北站',
      content: { summary: '林晚抵达北站。', beats: ['抵达', '发现'] },
      createdAt: fixtureTime,
    },
  });

  const chapterTwoOutlineId = outlineId('outline-2');
  planning.saveApprovedOutline({
    outline: {
      id: chapterTwoOutlineId,
      projectId: fixtureProjectId,
      position: 2,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    },
    revision: {
      id: 'outline-revision-2',
      revisionNumber: 1,
      title: '追票',
      content: { summary: '林晚追查车票。', beats: ['询问', '追踪'] },
      createdAt: fixtureTime,
    },
  });

  chapters.saveCandidate({
    chapter: {
      id: fixtureChapterId,
      projectId: fixtureProjectId,
      outlineId: fixtureOutlineId,
      createdAt: fixtureTime,
    },
    revision: {
      id: fixtureChapterRevisionId,
      revisionNumber: 1,
      source: 'generated',
      parentRevisionId: null,
      title: '北站',
      content: '林晚抵达北站，发现车票失踪。',
      wordCount: 14,
      status: 'draft',
      generationRunId: 'run-1',
      createdAt: fixtureTime,
    },
  });
  chapters.publishRevision(fixtureChapterRevisionId);
  states.save({
    id: fixtureStateRevisionId,
    projectId: fixtureProjectId,
    chapterId: fixtureChapterId,
    chapterRevisionId: fixtureChapterRevisionId,
    previousStateRevisionId: null,
    sequence: 1,
    status: 'current',
    state: fixtureStoryState(),
    delta: fixtureStoryStateDelta(),
    summary: '林晚抵达北站。',
    model: 'test-model',
    promptVersion: 'state-v1',
    createdAt: fixtureTime,
  });

  return {
    compiler: new ContextCompiler(db),
    chapters,
    states,
  };
}

it('compiles outline, previous state, recent chapters, arc summaries, genre, and stable hash', () => {
  const testDb = createTestDb();
  const { compiler } = seedFoundation(testDb.db);

  const context = compiler.compileChapterContext({
    projectId: fixtureProjectId,
    outlinePosition: 2,
    promptTemplateVersion: 'chapter-v1',
  });

  assert.equal(context.outlinePosition, 2);
  assert.equal(context.genreProfile, '悬疑');
  assert.equal(context.outline.revision.id, 'outline-revision-2');
  assert.equal(context.outline.revision.title, '追票');
  assert.equal(context.previousStateRevisionId, fixtureStateRevisionId);
  assert.deepEqual(context.previousState, fixtureStoryState());
  assert.equal(context.recentChapters.length, 1);
  assert.equal(context.recentChapters[0]?.revisionId, fixtureChapterRevisionId);
  assert.ok(context.recentChapters[0]?.content.includes('车票失踪'));
  assert.ok(Array.isArray(context.arcSummaries));
  assert.equal(context.promptTemplateVersion, 'chapter-v1');
  assert.match(context.contextHash, /^[a-f0-9]{64}$/);

  const again = compiler.compileChapterContext({
    projectId: fixtureProjectId,
    outlinePosition: 2,
    promptTemplateVersion: 'chapter-v1',
  });
  assert.equal(again.contextHash, context.contextHash);
  assert.equal(
    createHash('sha256').update(context.contextHash, 'utf8').digest('hex').length,
    64,
  );

  testDb.cleanup();
});

it('does not embed mutable initial character state from Bible text', () => {
  const testDb = createTestDb();
  const { compiler } = seedFoundation(testDb.db);

  const context = compiler.compileChapterContext({
    projectId: fixtureProjectId,
    outlinePosition: 2,
    promptTemplateVersion: 'chapter-v1',
  });

  assert.ok(context.bible.compiledText.includes('世界规则'));
  assert.equal(context.bible.compiledText.includes(mutableCharacterSnippet), false);
  assert.equal('characterState' in context.bible, false);
  assert.equal(
    JSON.stringify(context).includes(mutableCharacterSnippet),
    false,
  );

  testDb.cleanup();
});

it('includes arc summaries from current state ledger at arc boundaries', () => {
  const testDb = createTestDb();
  const { compiler, chapters, states } = seedFoundation(testDb.db);
  const planning = new PlanningRepository(testDb.db);

  let previousStateId = fixtureStateRevisionId;
  for (let position = 2; position <= 10; position++) {
    const outline = position === 2 ? outlineId('outline-2') : outlineId(`outline-${position}`);
    const chapter = chapterId(`chapter-${position}`);
    const revision = chapterRevisionId(`chapter-revision-${position}`);
    const stateId = storyStateRevisionId(`state-revision-${position}`);
    if (position > 2) {
      planning.saveApprovedOutline({
        outline: {
          id: outline,
          projectId: fixtureProjectId,
          position,
          createdAt: fixtureTime,
          updatedAt: fixtureTime,
        },
        revision: {
          id: `outline-revision-${position}`,
          revisionNumber: 1,
          title: `第 ${position} 章`,
          content: { summary: `第 ${position} 章`, beats: [] },
          createdAt: fixtureTime,
        },
      });
    }
    chapters.saveCandidate({
      chapter: {
        id: chapter,
        projectId: fixtureProjectId,
        outlineId: outline,
        createdAt: fixtureTime,
      },
      revision: {
        id: revision,
        revisionNumber: 1,
        source: 'generated',
        parentRevisionId: null,
        title: `第 ${position} 章`,
        content: `第 ${position} 章正文`,
        wordCount: 6,
        status: 'draft',
        generationRunId: `run-${position}`,
        createdAt: fixtureTime,
      },
    });
    chapters.publishRevision(revision);
    states.save({
      id: stateId,
      projectId: fixtureProjectId,
      chapterId: chapter,
      chapterRevisionId: revision,
      previousStateRevisionId: previousStateId,
      sequence: position,
      status: 'current',
      state: {
        characters: [],
        facts: [],
        foreshadows: [],
        timeline: [],
        summary: `卷摘要候选至第 ${position} 章`,
      },
      delta: {
        characterChanges: [],
        factChanges: [],
        foreshadowChanges: [],
        timelineEvents: [],
        summary: `卷摘要候选至第 ${position} 章`,
      },
      summary: `卷摘要候选至第 ${position} 章`,
      model: 'test-model',
      promptVersion: 'state-v1',
      createdAt: fixtureTime,
    });
    previousStateId = stateId;
  }

  planning.saveApprovedOutline({
    outline: {
      id: outlineId('outline-11'),
      projectId: fixtureProjectId,
      position: 11,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    },
    revision: {
      id: 'outline-revision-11',
      revisionNumber: 1,
      title: '第 11 章',
      content: { summary: '第 11 章', beats: [] },
      createdAt: fixtureTime,
    },
  });

  const context = compiler.compileChapterContext({
    projectId: fixtureProjectId,
    outlinePosition: 11,
    promptTemplateVersion: 'chapter-v1',
    arcInterval: 10,
  });

  assert.ok(context.arcSummaries.some((summary) => summary.upToPosition === 10));
  assert.ok(
    context.arcSummaries.some((summary) => summary.content.includes('第 10 章')),
  );

  testDb.cleanup();
});
