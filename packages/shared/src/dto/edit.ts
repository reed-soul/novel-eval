import { fail, isRecord, type ParseResult } from './parse.ts';

/** Story-state snapshot required by chapter edit (mirrors writer StoryState shape). */
export interface StoryStateDto {
  characters: unknown[];
  facts: unknown[];
  foreshadows: unknown[];
  timeline: unknown[];
  summary: string;
}

/** Story-state delta required by chapter edit (mirrors writer StoryStateDelta shape). */
export interface StoryStateDeltaDto {
  characterChanges: unknown[];
  factChanges: unknown[];
  foreshadowChanges: unknown[];
  timelineEvents: unknown[];
  summary: string;
}

export interface EditChapterRequest {
  content: string;
  title?: string;
  state: StoryStateDto;
  delta: StoryStateDeltaDto;
  model?: string;
  promptVersion?: string;
}

function isStoryStateDto(value: unknown): value is StoryStateDto {
  if (!isRecord(value)) return false;
  return Array.isArray(value.characters)
    && Array.isArray(value.facts)
    && Array.isArray(value.foreshadows)
    && Array.isArray(value.timeline)
    && typeof value.summary === 'string';
}

function isStoryStateDeltaDto(value: unknown): value is StoryStateDeltaDto {
  if (!isRecord(value)) return false;
  return Array.isArray(value.characterChanges)
    && Array.isArray(value.factChanges)
    && Array.isArray(value.foreshadowChanges)
    && Array.isArray(value.timelineEvents)
    && typeof value.summary === 'string';
}

export function parseEditChapterRequest(raw: unknown): ParseResult<EditChapterRequest> {
  if (!isRecord(raw)) return fail('编辑请求体必须是对象');

  if (typeof raw.content !== 'string' || raw.content.trim().length === 0) {
    return fail('正文不能为空');
  }

  if (!isStoryStateDto(raw.state) || !isStoryStateDeltaDto(raw.delta)) {
    return fail('编辑必须提供有效的 state 与 delta；禁止缺省写入空壳 story state');
  }

  const data: EditChapterRequest = {
    content: raw.content,
    state: raw.state,
    delta: raw.delta,
  };

  if (typeof raw.title === 'string') data.title = raw.title;
  if (typeof raw.model === 'string') data.model = raw.model;
  if (typeof raw.promptVersion === 'string') data.promptVersion = raw.promptVersion;

  return { ok: true, data };
}
