import { createHash } from 'node:crypto';

import type { DB } from '../db.ts';
import type { ProjectId, StoryStateRevisionId } from '../domain/ids.ts';
import type { StoryState } from '../domain/story-state.ts';
import { ChapterRepository } from '../repositories/chapter-repository.ts';
import {
  PlanningRepository,
  type ApprovedOutline,
  type BibleDocument,
} from '../repositories/planning-repository.ts';
import { ProjectRepository } from '../repositories/project-repository.ts';
import { StoryStateRepository } from '../repositories/story-state-repository.ts';
import type { JsonValue } from '../repositories/validation.ts';
import { getRuntimeConfig } from '../runtime-config.ts';

export interface CompileChapterContextInput {
  projectId: ProjectId;
  outlinePosition: number;
  promptTemplateVersion: string;
  recentWindow?: number;
  arcInterval?: number;
}

export interface CompiledArcSummary {
  upToPosition: number;
  content: string;
}

export interface CompiledRecentChapter {
  position: number;
  revisionId: ReturnType<typeof import('../domain/ids.ts').chapterRevisionId>;
  title: string;
  content: string;
}

export interface CompiledChapterContext {
  projectId: ProjectId;
  outlinePosition: number;
  genreProfile: string;
  bible: {
    revisionId: string;
    compiledText: string;
  };
  outline: ApprovedOutline;
  previousStateRevisionId: StoryStateRevisionId | null;
  previousState: StoryState | null;
  recentChapters: CompiledRecentChapter[];
  arcSummaries: CompiledArcSummary[];
  promptTemplateVersion: string;
  contextHash: string;
}

const MUTABLE_BIBLE_KEYS = new Set([
  'characterState',
  'character_state',
  'initialCharacterState',
  'initial_character_state',
]);

function collectMutableStrings(value: JsonValue, into: string[]): void {
  if (typeof value === 'string') {
    if (value.trim().length > 0) into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMutableStrings(item, into);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      collectMutableStrings(nested, into);
    }
  }
}

function stripMutableBibleFields(bible: BibleDocument): BibleDocument {
  const result: BibleDocument = {};
  for (const [key, value] of Object.entries(bible)) {
    if (MUTABLE_BIBLE_KEYS.has(key)) continue;
    result[key] = value;
  }
  return result;
}

function sanitizeCompiledText(compiledText: string, bible: BibleDocument): string {
  const mutableSnippets: string[] = [];
  for (const [key, value] of Object.entries(bible)) {
    if (!MUTABLE_BIBLE_KEYS.has(key)) continue;
    collectMutableStrings(value, mutableSnippets);
  }
  let text = compiledText;
  for (const snippet of mutableSnippets.sort((a, b) => b.length - a.length)) {
    text = text.split(snippet).join('');
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key]);
    }
    return sorted;
  }
  return value;
}

export class ContextCompiler {
  private readonly projects: ProjectRepository;
  private readonly planning: PlanningRepository;
  private readonly chapters: ChapterRepository;
  private readonly states: StoryStateRepository;

  constructor(private readonly db: DB) {
    this.projects = new ProjectRepository(db);
    this.planning = new PlanningRepository(db);
    this.chapters = new ChapterRepository(db);
    this.states = new StoryStateRepository(db);
  }

  compileChapterContext(input: CompileChapterContextInput): CompiledChapterContext {
    if (!Number.isInteger(input.outlinePosition) || input.outlinePosition <= 0) {
      throw new Error('outlinePosition must be a positive integer');
    }

    const project = this.projects.get(input.projectId);
    if (!project) throw new Error(`Project ${input.projectId} does not exist`);

    const outline = this.planning.getApprovedOutlineAtPosition(
      input.projectId,
      input.outlinePosition,
    );
    if (!outline) {
      throw new Error(
        `Approved outline at position ${input.outlinePosition} does not exist`,
      );
    }

    const bible = this.planning.getActiveBibleForProject(input.projectId);
    if (!bible) {
      throw new Error(`Project ${input.projectId} has no active Bible revision`);
    }

    const previousState = input.outlinePosition === 1
      ? null
      : this.states.getCurrentAtPosition(input.projectId, input.outlinePosition - 1);

    const recentWindow = input.recentWindow
      ?? getRuntimeConfig().generation.recentWindow;
    const arcInterval = input.arcInterval
      ?? getRuntimeConfig().generation.arcInterval;

    const recentChapters = this.chapters.listRecentActiveRevisions(
      input.projectId,
      input.outlinePosition,
      recentWindow,
    );
    const arcSummaries = this.states.listArcSummaries(
      input.projectId,
      input.outlinePosition,
      arcInterval,
    );

    const sanitizedBible = stripMutableBibleFields(bible.bible);
    const compiledText = sanitizeCompiledText(bible.compiledText, bible.bible);

    const hashPayload = {
      projectId: input.projectId,
      outlinePosition: input.outlinePosition,
      genreProfile: project.genreProfile,
      bibleRevisionId: bible.id,
      bibleText: compiledText,
      bibleDocument: sanitizedBible,
      outlineRevisionId: outline.revision.id,
      outlineTitle: outline.revision.title,
      outlineContent: outline.revision.content,
      previousStateRevisionId: previousState?.id ?? null,
      previousState: previousState?.state ?? null,
      recentChapters,
      arcSummaries,
      promptTemplateVersion: input.promptTemplateVersion,
    };

    const contextHash = createHash('sha256')
      .update(canonicalJson(hashPayload), 'utf8')
      .digest('hex');

    return {
      projectId: input.projectId,
      outlinePosition: input.outlinePosition,
      genreProfile: project.genreProfile,
      bible: {
        revisionId: bible.id,
        compiledText,
      },
      outline,
      previousStateRevisionId: previousState?.id ?? null,
      previousState: previousState?.state ?? null,
      recentChapters,
      arcSummaries,
      promptTemplateVersion: input.promptTemplateVersion,
      contextHash,
    };
  }
}
