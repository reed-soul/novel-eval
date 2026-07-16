import { randomUUID } from 'node:crypto';

import type { ExtractStoryStateResult } from '../chapter/finalizer.ts';
import type { DB } from '../db.ts';
import { ProjectLeaseConflictError } from '../domain/errors.ts';
import {
  storyStateRevisionId,
  type ChapterRevisionId,
  type ProjectId,
  type StoryStateRevisionId,
} from '../domain/ids.ts';
import type { StoryState } from '../domain/story-state.ts';
import { ChapterRepository } from '../repositories/chapter-repository.ts';
import type { ProjectWriteLease } from '../repositories/lease-repository.ts';
import { StoryStateRepository } from '../repositories/story-state-repository.ts';

export interface RebuildExtractInput {
  outlinePosition: number;
  previousState: StoryState | null;
  previousStateRevisionId: StoryStateRevisionId | null;
  chapterRevisionId: ChapterRevisionId;
  title: string;
  content: string;
}

export interface RebuildFromInput {
  projectId: ProjectId;
  fromOutlinePosition: number;
  lease: ProjectWriteLease;
  extractState: (input: RebuildExtractInput) => Promise<ExtractStoryStateResult>;
}

export interface RebuildResult {
  rebuiltOutlinePositions: number[];
  failedAtOutlinePosition: number | null;
  currentStateRevisionId: StoryStateRevisionId | null;
}

export class StateRebuildService {
  private readonly chapters: ChapterRepository;
  private readonly states: StoryStateRepository;

  constructor(
    private readonly db: DB,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.chapters = new ChapterRepository(db);
    this.states = new StoryStateRepository(db);
  }

  async rebuildFrom(input: RebuildFromInput): Promise<RebuildResult> {
    if (input.lease.projectId !== input.projectId) {
      throw new Error('Lease project does not match rebuild project');
    }
    if (!Number.isInteger(input.fromOutlinePosition) || input.fromOutlinePosition <= 0) {
      throw new Error('fromOutlinePosition must be a positive integer');
    }

    this.assertActiveLease(input.lease, this.rebuildTime());

    const predecessor = input.fromOutlinePosition === 1
      ? null
      : this.states.getCurrentAtPosition(input.projectId, input.fromOutlinePosition - 1);
    if (input.fromOutlinePosition > 1 && !predecessor) {
      throw new Error(
        `Rebuild from ${input.fromOutlinePosition} requires current state at position ${input.fromOutlinePosition - 1}`,
      );
    }

    const rebuiltOutlinePositions: number[] = [];
    let currentStateRevisionId: StoryStateRevisionId | null = predecessor?.id ?? null;

    for (let position = input.fromOutlinePosition; ; position += 1) {
      const chapter = this.chapters.getByOutlinePosition(input.projectId, position);
      if (!chapter || chapter.activeRevisionId === null) {
        break;
      }

      const active = this.chapters.getActiveRevision(chapter.id);
      if (!active) {
        break;
      }

      const previousState = position === 1
        ? null
        : this.states.getCurrentAtPosition(input.projectId, position - 1);
      if (position > 1 && !previousState) {
        return {
          rebuiltOutlinePositions,
          failedAtOutlinePosition: position,
          currentStateRevisionId,
        };
      }

      let extraction: ExtractStoryStateResult;
      try {
        extraction = await input.extractState({
          outlinePosition: position,
          previousState: previousState?.state ?? null,
          previousStateRevisionId: previousState?.id ?? null,
          chapterRevisionId: active.id,
          title: active.title,
          content: active.content,
        });
      } catch {
        return {
          rebuiltOutlinePositions,
          failedAtOutlinePosition: position,
          currentStateRevisionId,
        };
      }

      const appendTime = this.rebuildTime();
      this.assertActiveLease(input.lease, appendTime);

      const append = this.db.transaction((): StoryStateRevisionId => {
        this.assertActiveLease(input.lease, appendTime);

        const livePredecessor = position === 1
          ? null
          : this.states.getCurrentAtPosition(input.projectId, position - 1);
        if (position > 1 && (!livePredecessor || livePredecessor.id !== previousState?.id)) {
          throw new Error(
            `Chapter ${position} requires the current state from chapter ${position - 1}`,
          );
        }

        this.states.invalidateCurrentFromPosition(input.projectId, position);

        const stateId = storyStateRevisionId(randomUUID());
        this.states.save({
          id: stateId,
          projectId: input.projectId,
          chapterId: chapter.id,
          chapterRevisionId: active.id,
          previousStateRevisionId: livePredecessor?.id ?? null,
          sequence: position,
          status: 'current',
          state: extraction.state,
          delta: extraction.delta,
          summary: extraction.state.summary,
          model: extraction.model,
          promptVersion: extraction.promptVersion,
          createdAt: appendTime,
        });
        return stateId;
      });

      // Lease/append failures must propagate; only extraction soft-fails above.
      currentStateRevisionId = append.immediate();
      rebuiltOutlinePositions.push(position);
    }

    return {
      rebuiltOutlinePositions,
      failedAtOutlinePosition: null,
      currentStateRevisionId,
    };
  }

  private rebuildTime(): string {
    const now = this.now();
    if (!Number.isFinite(now.getTime())) {
      throw new TypeError('Rebuild time must be a valid Date');
    }
    return now.toISOString();
  }

  private assertActiveLease(lease: ProjectWriteLease, now: string): void {
    const row: unknown = this.db.prepare(`
      SELECT id
      FROM project_write_lease
      WHERE id = ?
        AND project_id = ?
        AND job_id = ?
        AND owner_id = ?
        AND expires_at > ?
    `).get(
      lease.id,
      lease.projectId,
      lease.jobId,
      lease.ownerId,
      now,
    );
    if (row === undefined) {
      throw new ProjectLeaseConflictError();
    }
  }
}
