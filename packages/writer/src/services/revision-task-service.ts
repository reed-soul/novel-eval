import { randomUUID } from 'node:crypto';

import type { EvaluationSuggestionDto } from '@novel-eval/shared';

import type { DB } from '../db.ts';
import { ValidationError } from '../domain/errors.ts';
import { ProjectRepository } from '../repositories/project-repository.ts';
import {
  REVISION_TASK_STATUSES,
  RevisionTaskRepository,
  type RevisionTask,
  type RevisionTaskScope,
  type RevisionTaskStatus,
} from '../repositories/revision-task-repository.ts';
import { projectId as toProjectId } from '../domain/ids.ts';

export interface ImportFromEvalInput {
  projectId: string;
  suggestions?: readonly unknown[];
  /** Full report / result envelope — uses `.suggestions` when present. */
  result?: { suggestions?: readonly unknown[] } | null;
  sourceEvalTaskId?: string | null;
  /** When true, dismiss existing `open` tasks before inserting. */
  replaceOpen?: boolean;
  now?: string;
}

export interface ImportFromEvalResult {
  created: RevisionTask[];
  dismissedOpenCount: number;
}

export interface SetRevisionTaskStatusInput {
  projectId: string;
  taskId: string;
  status: RevisionTaskStatus;
  now?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inferScope(relatedChapters: string[] | undefined): RevisionTaskScope {
  const count = relatedChapters?.length ?? 0;
  if (count === 1) return 'chapter';
  if (count > 1) return 'volume';
  return 'book';
}

function normalizeSuggestion(raw: unknown): EvaluationSuggestionDto | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.dimension !== 'string' || typeof raw.content !== 'string') return null;
  if (raw.content.trim() === '') return null;
  const suggestion: EvaluationSuggestionDto = {
    dimension: raw.dimension,
    content: raw.content,
  };
  if (typeof raw.type === 'string') suggestion.type = raw.type;
  if (Array.isArray(raw.relatedChapters)) {
    suggestion.relatedChapters = raw.relatedChapters.filter(
      (item): item is string => typeof item === 'string',
    );
  }
  if (
    isRecord(raw.excerptRef)
    && typeof raw.excerptRef.chapterId === 'string'
    && typeof raw.excerptRef.excerptIndex === 'number'
  ) {
    suggestion.excerptRef = {
      chapterId: raw.excerptRef.chapterId,
      excerptIndex: raw.excerptRef.excerptIndex,
    };
  } else if (raw.excerptRef === null) {
    suggestion.excerptRef = null;
  }
  return suggestion;
}

function resolveSuggestions(input: ImportFromEvalInput): EvaluationSuggestionDto[] {
  const fromList = input.suggestions;
  const fromResult = input.result?.suggestions;
  const raw = fromList ?? fromResult;
  if (!Array.isArray(raw)) {
    throw new ValidationError('from-eval requires suggestions[] or result.suggestions[]');
  }
  const suggestions: EvaluationSuggestionDto[] = [];
  for (const item of raw) {
    const normalized = normalizeSuggestion(item);
    if (normalized) suggestions.push(normalized);
  }
  return suggestions;
}

export function isRevisionTaskStatus(value: unknown): value is RevisionTaskStatus {
  return typeof value === 'string'
    && (REVISION_TASK_STATUSES as readonly string[]).includes(value);
}

export class RevisionTaskService {
  private readonly tasks: RevisionTaskRepository;
  private readonly projects: ProjectRepository;

  constructor(private readonly db: DB) {
    this.tasks = new RevisionTaskRepository(db);
    this.projects = new ProjectRepository(db);
  }

  importFromEval(input: ImportFromEvalInput): ImportFromEvalResult {
    const project = this.projects.get(toProjectId(input.projectId));
    if (!project) {
      throw new ValidationError(`project not found: ${input.projectId}`);
    }

    const suggestions = resolveSuggestions(input);
    const now = input.now ?? new Date().toISOString();

    return this.db.transaction((): ImportFromEvalResult => {
      let dismissedOpenCount = 0;
      if (input.replaceOpen) {
        // Replace the open backlog only; done / in_progress / dismissed stay.
        dismissedOpenCount = this.tasks.dismissOpen(input.projectId, { now });
      }

      const created: RevisionTask[] = [];
      for (const suggestion of suggestions) {
        const relatedChapters = suggestion.relatedChapters ?? [];
        created.push(
          this.tasks.create({
            id: randomUUID(),
            projectId: input.projectId,
            scope: inferScope(relatedChapters),
            dimension: suggestion.dimension,
            content: suggestion.content,
            type: suggestion.type ?? null,
            relatedChapters,
            excerptRef: suggestion.excerptRef ?? null,
            sourceEvalTaskId: input.sourceEvalTaskId ?? null,
            sourceKind: 'evaluation_report',
            now,
          }),
        );
      }
      return { created, dismissedOpenCount };
    })();
  }

  list(
    projectId: string,
    options?: { status?: RevisionTaskStatus },
  ): RevisionTask[] {
    const project = this.projects.get(toProjectId(projectId));
    if (!project) {
      throw new ValidationError(`project not found: ${projectId}`);
    }
    return this.tasks.listByProject(projectId, options);
  }

  get(projectId: string, taskId: string): RevisionTask | null {
    const task = this.tasks.findById(taskId);
    if (!task || task.projectId !== projectId) return null;
    return task;
  }

  setStatus(input: SetRevisionTaskStatusInput): RevisionTask {
    if (!isRevisionTaskStatus(input.status)) {
      throw new ValidationError(
        `invalid status: ${String(input.status)}; expected one of ${REVISION_TASK_STATUSES.join(', ')}`,
      );
    }
    const existing = this.get(input.projectId, input.taskId);
    if (!existing) {
      throw new ValidationError(`revision task not found: ${input.taskId}`);
    }
    const updated = this.tasks.updateStatus(
      input.taskId,
      input.status,
      input.now ?? new Date().toISOString(),
    );
    if (!updated) {
      throw new ValidationError(`revision task not found: ${input.taskId}`);
    }
    return updated;
  }
}
