import assert from 'node:assert/strict';
import { it } from 'node:test';

import { InvalidPersistenceDataError } from '../../src/domain/errors.ts';
import { chapterRevisionId, outlineId, storyStateRevisionId } from '../../src/domain/ids.ts';
import { createProject } from '../../src/project.ts';
import { ChapterRepository } from '../../src/repositories/chapter-repository.ts';
import { PlanningRepository } from '../../src/repositories/planning-repository.ts';
import { ProjectRepository } from '../../src/repositories/project-repository.ts';
import { StoryStateRepository } from '../../src/repositories/story-state-repository.ts';
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

it('exposes only the new project vocabulary', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());

  const project = createProject(testDb.db, {
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: '林晚追查一张失踪的车票。',
  });

  assert.equal(project.status, 'draft');
  assert.equal(project.genreProfile, '悬疑');
  assert.equal(project.targetAudience, '成人');
  assert.equal(project.premise, '林晚追查一张失踪的车票。');
  assert.equal('genre' in project, false);
  assert.equal('audience' in project, false);
  assert.equal('topic' in project, false);
});

it('persists and reads a complete versioned story foundation', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const projects = new ProjectRepository(testDb.db);
  const planning = new PlanningRepository(testDb.db);
  const chapters = new ChapterRepository(testDb.db);
  const states = new StoryStateRepository(testDb.db);

  const project = projects.create({
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
    bible: { premise: project.premise, themes: ['记忆'] },
    compiledText: '故事圣经',
    createdAt: fixtureTime,
  });
  projects.setActiveBibleRevision(fixtureProjectId, bible.id, fixtureTime);
  planning.saveBeats([{
    id: 'beat-1',
    projectId: fixtureProjectId,
    bibleRevisionId: bible.id,
    position: 1,
    act: 1,
    content: { goal: '抵达北站', outcome: '发现车票失踪' },
    createdAt: fixtureTime,
  }]);
  const outline = planning.saveApprovedOutline({
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
  const candidate = chapters.saveCandidate({
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
      content: '林晚抵达北站。',
      wordCount: 8,
      status: 'draft',
      generationRunId: 'run-1',
      createdAt: fixtureTime,
    },
  });
  const stateRevision = states.save({
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
    promptVersion: 'v1',
    createdAt: fixtureTime,
  });

  assert.deepEqual(projects.get(fixtureProjectId), {
    ...project,
    activeBibleRevisionId: bible.id,
    updatedAt: fixtureTime,
  });
  assert.deepEqual(planning.getBibleRevision(bible.id), bible);
  assert.deepEqual(planning.listBeats(fixtureProjectId), [{
    id: 'beat-1',
    projectId: fixtureProjectId,
    bibleRevisionId: bible.id,
    position: 1,
    act: 1,
    content: { goal: '抵达北站', outcome: '发现车票失踪' },
    createdAt: fixtureTime,
  }]);
  assert.deepEqual(planning.getApprovedOutline(fixtureOutlineId), outline);
  assert.deepEqual(chapters.getRevision(fixtureChapterRevisionId), candidate);
  assert.deepEqual(states.get(fixtureStateRevisionId), stateRevision);
  assert.deepEqual(states.getCurrent(fixtureProjectId), stateRevision);
});

it('rejects persisted JSON that does not match the domain model', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const projects = new ProjectRepository(testDb.db);
  const planning = new PlanningRepository(testDb.db);
  const chapters = new ChapterRepository(testDb.db);
  const states = new StoryStateRepository(testDb.db);

  projects.create({
    id: fixtureProjectId,
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: 'Premise',
    createdAt: fixtureTime,
  });
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
      content: { summary: 'Summary', beats: [] },
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
      content: '正文',
      wordCount: 2,
      status: 'draft',
      generationRunId: null,
      createdAt: fixtureTime,
    },
  });
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
    summary: 'Summary',
    model: 'test',
    promptVersion: 'v1',
    createdAt: fixtureTime,
  });
  testDb.db.prepare(
    'UPDATE story_state_revision SET state_json = ? WHERE id = ?',
  ).run('{"characters":"not-an-array"}', fixtureStateRevisionId);

  assert.throws(
    () => states.get(storyStateRevisionId('state-revision-1')),
    InvalidPersistenceDataError,
  );

  testDb.db.prepare(
    'UPDATE chapter_outline_revision SET content_json = ? WHERE id = ?',
  ).run('{"summary":42,"beats":[]}', 'outline-revision-1');
  assert.throws(
    () => planning.getApprovedOutline(fixtureOutlineId),
    InvalidPersistenceDataError,
  );

  assert.equal(
    chapters.getRevision(chapterRevisionId('missing')),
    null,
  );
});

it('validates outline content before writing it', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  const projects = new ProjectRepository(testDb.db);
  const planning = new PlanningRepository(testDb.db);
  projects.create({
    id: fixtureProjectId,
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: 'Premise',
    createdAt: fixtureTime,
  });
  const invalidInput: unknown = {
    outline: {
      id: outlineId('outline-invalid'),
      projectId: fixtureProjectId,
      position: 1,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    },
    revision: {
      id: 'outline-revision-invalid',
      revisionNumber: 1,
      title: '北站',
      content: { summary: 'Summary', beats: [undefined] },
      createdAt: fixtureTime,
    },
  };

  assert.throws(
    () => Reflect.apply(planning.saveApprovedOutline, planning, [invalidInput]),
    InvalidPersistenceDataError,
  );
  const row = testDb.db.prepare(
    "SELECT COUNT(*) AS count FROM chapter_outline WHERE id = 'outline-invalid'",
  ).get();
  assert.deepEqual(row, { count: 0 });
});
