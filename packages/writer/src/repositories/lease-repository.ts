import { randomUUID } from 'node:crypto';

import type { DB } from '../db.ts';
import { ProjectLeaseConflictError } from '../domain/errors.ts';
import { projectId, type ProjectId } from '../domain/ids.ts';
import { persistedRecord, stringField } from './validation.ts';

export interface ProjectWriteLease {
  id: string;
  projectId: ProjectId;
  jobId: string;
  ownerId: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AcquireProjectWriteLeaseInput {
  projectId: ProjectId;
  jobId: string;
  ownerId: string;
  ttlMs: number;
  now: Date;
}

export interface RenewProjectWriteLeaseInput {
  leaseId: string;
  ownerId: string;
  ttlMs: number;
  now: Date;
}

export interface ReleaseProjectWriteLeaseInput {
  leaseId: string;
  ownerId: string;
}

function readLease(value: unknown): ProjectWriteLease {
  const entity = 'project write lease';
  const row = persistedRecord(value, entity);
  return {
    id: stringField(row, 'id', entity),
    projectId: projectId(stringField(row, 'project_id', entity)),
    jobId: stringField(row, 'job_id', entity),
    ownerId: stringField(row, 'owner_id', entity),
    expiresAt: stringField(row, 'expires_at', entity),
    createdAt: stringField(row, 'created_at', entity),
    updatedAt: stringField(row, 'updated_at', entity),
  };
}

function leaseTimes(now: Date, ttlMs: number): { now: string; expiresAt: string } {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new TypeError('ttlMs must be a positive finite number');
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new TypeError('now must be a valid Date');
  }
  return {
    now: now.toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  };
}

function isUniqueConstraint(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
    || error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export class ProjectWriteLeaseRepository {
  constructor(private readonly db: DB) {}

  acquire(input: AcquireProjectWriteLeaseInput): ProjectWriteLease {
    const { now, expiresAt } = leaseTimes(input.now, input.ttlMs);
    const acquireImmediate = this.db.transaction((): ProjectWriteLease => {
      this.db.prepare(`
        DELETE FROM project_write_lease
        WHERE project_id = ? AND expires_at <= ?
      `).run(input.projectId, now);

      const row: unknown = this.db.prepare(`
        INSERT INTO project_write_lease (
          id, project_id, job_id, owner_id, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `).get(
        randomUUID(),
        input.projectId,
        input.jobId,
        input.ownerId,
        expiresAt,
        now,
        now,
      );
      return readLease(row);
    });

    try {
      return acquireImmediate.immediate();
    } catch (error: unknown) {
      if (isUniqueConstraint(error)) {
        throw new ProjectLeaseConflictError();
      }
      throw error;
    }
  }

  renew(input: RenewProjectWriteLeaseInput): ProjectWriteLease {
    const { now, expiresAt } = leaseTimes(input.now, input.ttlMs);
    const row: unknown = this.db.prepare(`
      UPDATE project_write_lease
      SET expires_at = ?, updated_at = ?
      WHERE id = ? AND owner_id = ?
      RETURNING *
    `).get(expiresAt, now, input.leaseId, input.ownerId);

    if (row === undefined) {
      throw new ProjectLeaseConflictError();
    }
    return readLease(row);
  }

  release(input: ReleaseProjectWriteLeaseInput): void {
    this.db.prepare(`
      DELETE FROM project_write_lease
      WHERE id = ? AND owner_id = ?
    `).run(input.leaseId, input.ownerId);
  }
}
