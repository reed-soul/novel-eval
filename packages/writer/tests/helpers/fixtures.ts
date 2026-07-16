import {
  chapterId,
  chapterRevisionId,
  characterId,
  outlineId,
  projectId,
  storyStateRevisionId,
} from '../../src/domain/ids.ts';
import type { StoryState, StoryStateDelta } from '../../src/domain/story-state.ts';

export const fixtureTime = '2026-07-16T09:00:00.000Z';
export const fixtureProjectId = projectId('project-1');
export const fixtureOutlineId = outlineId('outline-1');
export const fixtureChapterId = chapterId('chapter-1');
export const fixtureChapterRevisionId = chapterRevisionId('chapter-revision-1');
export const fixtureStateRevisionId = storyStateRevisionId('state-revision-1');

export function fixtureStoryState(): StoryState {
  return {
    characters: [{
      id: characterId('lin'),
      name: '林晚',
      status: 'alive',
      facts: ['左手受伤'],
    }],
    facts: [{
      fact: '林晚到达北站',
      sourceChapterRevisionId: fixtureChapterRevisionId,
    }],
    foreshadows: [],
    timeline: [{
      event: '林晚抵达北站',
      chapterRevisionId: fixtureChapterRevisionId,
    }],
    summary: '林晚抵达北站。',
  };
}

export function fixtureStoryStateDelta(): StoryStateDelta {
  return {
    characterChanges: [],
    factChanges: [{
      kind: 'add',
      fact: '林晚到达北站',
      sourceChapterRevisionId: fixtureChapterRevisionId,
    }],
    foreshadowChanges: [],
    timelineEvents: [{
      event: '林晚抵达北站',
      chapterRevisionId: fixtureChapterRevisionId,
    }],
    summary: '林晚抵达北站。',
  };
}
