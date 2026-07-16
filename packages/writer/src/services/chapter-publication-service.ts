import { randomUUID } from 'node:crypto';

import type { DB } from '../db.ts';
import { ProjectLeaseConflictError } from '../domain/errors.ts';
import {
  storyStateRevisionId,
  type ChapterRevisionId,
  type StoryStateRevisionId,
} from '../domain/ids.ts';
import {
  applyStoryStateDelta,
  type StoryState,
  type StoryStateDelta,
} from '../domain/story-state.ts';
import { ChapterRepository } from '../repositories/chapter-repository.ts';
import type { ProjectWriteLease } from '../repositories/lease-repository.ts';
import { StoryStateRepository } from '../repositories/story-state-repository.ts';
import {
  numberField,
  oneOf,
  persistedRecord,
  stringField,
} from '../repositories/validation.ts';

export interface StaleImpact {
  affectedOutlinePositions: number[];
}

export interface PublishCandidateInput {
  lease: ProjectWriteLease;
  candidateRevisionId: ChapterRevisionId;
  previousStateRevisionId: StoryStateRevisionId | null;
  state: StoryState;
  delta: StoryStateDelta;
  model: string;
  promptVersion: string;
  checkpoint: {
    jobId: string;
    outlinePosition: number;
  };
}

export interface PublishResult {
  chapterRevisionId: ChapterRevisionId;
  storyStateRevisionId: StoryStateRevisionId;
  outlineStatus: 'written';
  staleImpact: StaleImpact;
}

export class ChapterPublicationService {
  private readonly chapters: ChapterRepository;
  private readonly states: StoryStateRepository;

  constructor(
    private readonly db: DB,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.chapters = new ChapterRepository(db);
    this.states = new StoryStateRepository(db);
  }

  publishCandidate(input: PublishCandidateInput): PublishResult {
    return this.publishRevision(input);
  }

  publishHistoricalRevision(input: PublishCandidateInput): PublishResult {
    return this.publishRevision(input);
  }

  private publishRevision(input: PublishCandidateInput): PublishResult {
    this.assertActiveLease(input, this.publicationTime());

    const publish = this.db.transaction((): PublishResult => {
      const publicationTime = this.publicationTime();
      this.assertActiveLease(input, publicationTime);

      const candidate = this.chapters.getRevision(input.candidateRevisionId);
      if (!candidate) {
        throw new Error(`Chapter revision ${input.candidateRevisionId} does not exist`);
      }
      if (candidate.revision.status !== 'draft') {
        throw new Error(`Chapter revision ${input.candidateRevisionId} is not a draft`);
      }
      if (candidate.chapter.projectId !== input.lease.projectId) {
        throw new Error('Candidate and lease belong to different projects');
      }
      if (candidate.revision.parentRevisionId !== candidate.chapter.activeRevisionId) {
        throw new Error('Candidate parent does not match the active chapter revision');
      }

      const outlineValue: unknown = this.db.prepare(`
        SELECT position, status
        FROM chapter_outline
        WHERE id = ? AND project_id = ?
      `).get(candidate.chapter.outlineId, input.lease.projectId);
      if (outlineValue === undefined) {
        throw new Error(`Outline ${candidate.chapter.outlineId} does not exist`);
      }
      const outline = persistedRecord(outlineValue, 'publication outline');
      const position = numberField(outline, 'position', 'publication outline');
      oneOf(
        stringField(outline, 'status', 'publication outline'),
        ['approved', 'writing', 'written'] as const,
        'publication outline',
      );
      if (position !== input.checkpoint.outlinePosition) {
        throw new Error('Checkpoint position does not match the candidate outline');
      }

      this.assertPreviousState(input, position);
      this.assertStateMatchesDelta(input, position);

      const affectedOutlinePositions = this.states
        .listCurrentFromPosition(input.lease.projectId, position)
        .map((revision) => revision.sequence);
      this.states.invalidateCurrentFromPosition(input.lease.projectId, position);
      this.chapters.publishRevision(input.candidateRevisionId);

      const stateRevisionId = storyStateRevisionId(randomUUID());
      this.states.save({
        id: stateRevisionId,
        projectId: input.lease.projectId,
        chapterId: candidate.chapter.id,
        chapterRevisionId: input.candidateRevisionId,
        previousStateRevisionId: input.previousStateRevisionId,
        sequence: position,
        status: 'current',
        state: input.state,
        delta: input.delta,
        summary: input.state.summary,
        model: input.model,
        promptVersion: input.promptVersion,
        createdAt: publicationTime,
      });

      const outlineUpdate = this.db.prepare(`
        UPDATE chapter_outline
        SET status = 'written', updated_at = ?
        WHERE id = ? AND status IN ('approved', 'writing', 'written')
      `).run(publicationTime, candidate.chapter.outlineId);
      if (outlineUpdate.changes !== 1) {
        throw new Error(`Outline ${candidate.chapter.outlineId} could not be marked written`);
      }

      const checkpointUpdate = this.db.prepare(`
        UPDATE job
        SET checkpoint_json = ?, last_outline_position = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND status = 'running'
      `).run(
        JSON.stringify({ outlinePosition: position }),
        position,
        publicationTime,
        input.checkpoint.jobId,
        input.lease.projectId,
      );
      if (checkpointUpdate.changes !== 1) {
        throw new Error(`Job ${input.checkpoint.jobId} cannot accept a checkpoint`);
      }

      return {
        chapterRevisionId: input.candidateRevisionId,
        storyStateRevisionId: stateRevisionId,
        outlineStatus: 'written',
        staleImpact: { affectedOutlinePositions },
      };
    });

    return publish.immediate();
  }

  private publicationTime(): string {
    const now = this.now();
    if (!Number.isFinite(now.getTime())) {
      throw new TypeError('Publication time must be a valid Date');
    }
    return now.toISOString();
  }

  private assertActiveLease(input: PublishCandidateInput, now: string): void {
    if (input.checkpoint.jobId !== input.lease.jobId) {
      throw new ProjectLeaseConflictError();
    }
    const row: unknown = this.db.prepare(`
      SELECT id
      FROM project_write_lease
      WHERE id = ?
        AND project_id = ?
        AND job_id = ?
        AND owner_id = ?
        AND expires_at > ?
    `).get(
      input.lease.id,
      input.lease.projectId,
      input.lease.jobId,
      input.lease.ownerId,
      now,
    );
    if (row === undefined) {
      throw new ProjectLeaseConflictError();
    }
  }

  private assertPreviousState(input: PublishCandidateInput, position: number): void {
    if (!Number.isInteger(position) || position <= 0) {
      throw new Error('Outline position must be a positive integer');
    }
    if (position === 1) {
      if (input.previousStateRevisionId !== null) {
        throw new Error('The first chapter cannot have a previous story state');
      }
      return;
    }

    const previous = this.states.getCurrentAtPosition(input.lease.projectId, position - 1);
    if (!previous || previous.id !== input.previousStateRevisionId) {
      throw new Error(`Chapter ${position} requires the current state from chapter ${position - 1}`);
    }
  }

  private assertStateMatchesDelta(input: PublishCandidateInput, position: number): void {
    const previous: StoryState = position === 1
      ? emptyStoryState()
      : (() => {
          const revision = this.states.getCurrentAtPosition(input.lease.projectId, position - 1);
          if (!revision) {
            throw new Error(`Chapter ${position} requires the current state from chapter ${position - 1}`);
          }
          return revision.state;
        })();
    const expected = applyStoryStateDelta(previous, input.delta);
    if (!storyStatesEqual(expected, input.state)) {
      throw new Error(
        `Published state does not match applyDelta(previous, delta) at position ${position}`,
      );
    }
  }
}

function emptyStoryState(): StoryState {
  return {
    characters: [],
    facts: [],
    foreshadows: [],
    timeline: [],
    summary: '',
  };
}

function storyStatesEqual(left: StoryState, right: StoryState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
