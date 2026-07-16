import { randomUUID } from 'node:crypto';
import type { DB } from './db.ts';
import { projectId, type ProjectId } from './domain/ids.ts';
import { ProjectRepository } from './repositories/project-repository.ts';

export type ProjectStatus =
  | 'draft'
  | 'planning'
  | 'writing'
  | 'completed'
  | 'archived';

export interface Project {
  id: ProjectId;
  title: string;
  genreProfile: string;
  targetAudience: string;
  premise: string;
  status: ProjectStatus;
  activeBibleRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createProject(
  db: DB,
  opts: {
    title: string;
    genreProfile: string;
    targetAudience: string;
    premise: string;
  },
): Project {
  const id = projectId(randomUUID());
  const now = new Date().toISOString();
  return new ProjectRepository(db).create({
    id,
    title: opts.title,
    genreProfile: opts.genreProfile,
    targetAudience: opts.targetAudience,
    premise: opts.premise,
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
    status,
    new Date().toISOString(),
  );
}
