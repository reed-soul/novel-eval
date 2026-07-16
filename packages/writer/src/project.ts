import { randomUUID } from 'node:crypto';
import type { DB } from './db.ts';
import { projectId, type ProjectId } from './domain/ids.ts';
import { ProjectRepository } from './repositories/project-repository.ts';

export type PersistedProjectStatus =
  | 'draft'
  | 'planning'
  | 'writing'
  | 'completed'
  | 'archived';

export type ProjectStatus =
  | PersistedProjectStatus
  | 'initialized'
  | 'bible_done'
  | 'outlining';

export interface Project {
  id: ProjectId;
  title: string;
  genreProfile: string;
  targetAudience: string;
  premise: string;
  status: PersistedProjectStatus;
  activeBibleRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
  /** @deprecated compatibility alias for genreProfile */
  genre: string;
  /** @deprecated compatibility alias for targetAudience */
  audience: string;
  /** @deprecated compatibility alias for premise */
  topic: string;
}

function persistedStatus(status: ProjectStatus): PersistedProjectStatus {
  switch (status) {
    case 'initialized':
      return 'draft';
    case 'bible_done':
    case 'outlining':
      return 'planning';
    case 'draft':
    case 'planning':
    case 'writing':
    case 'completed':
    case 'archived':
      return status;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function createProject(
  db: DB,
  opts: { title: string; genre: string; audience: string; topic: string },
): Project {
  const id = projectId(randomUUID());
  const now = new Date().toISOString();
  return new ProjectRepository(db).create({
    id,
    title: opts.title,
    genreProfile: opts.genre,
    targetAudience: opts.audience,
    premise: opts.topic,
    createdAt: now,
  });
}

export function getProject(db: DB, rawProjectId: string): Project | null {
  return new ProjectRepository(db).get(projectId(rawProjectId));
}

export function listProjects(db: DB): Project[] {
  return new ProjectRepository(db).list();
}

export function updateProjectStatus(db: DB, rawProjectId: string, status: ProjectStatus): void {
  new ProjectRepository(db).updateStatus(
    projectId(rawProjectId),
    persistedStatus(status),
    new Date().toISOString(),
  );
}
