import assert from 'node:assert/strict';
import { it } from 'node:test';

import { ProjectLeaseConflictError } from '../../src/domain/errors.ts';
import { ProjectWriteLeaseRepository } from '../../src/repositories/lease-repository.ts';
import { ProjectRepository } from '../../src/repositories/project-repository.ts';
import { fixtureProjectId, fixtureTime } from '../helpers/fixtures.ts';
import { createTestDb } from '../helpers/test-db.ts';

function instant(value: string): Date {
  return new Date(value);
}

function seedProjectAndJobs(
  db: ReturnType<typeof createTestDb>['db'],
  jobIds: readonly string[],
): void {
  new ProjectRepository(db).create({
    id: fixtureProjectId,
    title: '北站',
    genreProfile: '悬疑',
    targetAudience: '成人',
    premise: '林晚追查一张失踪的车票。',
    createdAt: fixtureTime,
  });

  const insert = db.prepare(`
    INSERT INTO job (
      id, project_id, type, scope_json, input_json, engine, model, word_count,
      quality_profile, budget_json, prompt_version, status, created_at, updated_at
    ) VALUES (?, ?, 'chapter', '{}', '{}', 'test', 'test-model', 1000,
      'default', '{}', 'v1', 'running', ?, ?)
  `);
  for (const jobId of jobIds) {
    insert.run(jobId, fixtureProjectId, fixtureTime, fixtureTime);
  }
}

it('allows only one owner to acquire a project lease', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  seedProjectAndJobs(testDb.db, ['job-a', 'job-b']);
  const leases = new ProjectWriteLeaseRepository(testDb.db);

  const first = leases.acquire({
    projectId: fixtureProjectId,
    jobId: 'job-a',
    ownerId: 'worker-a',
    ttlMs: 30_000,
    now: instant('2026-07-16T09:00:00.000Z'),
  });

  assert.ok(first.id);
  assert.throws(
    () => leases.acquire({
      projectId: fixtureProjectId,
      jobId: 'job-b',
      ownerId: 'worker-b',
      ttlMs: 30_000,
      now: instant('2026-07-16T09:00:01.000Z'),
    }),
    ProjectLeaseConflictError,
  );
});

it('replaces an expired lease and rejects renewal by the old owner', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  seedProjectAndJobs(testDb.db, ['job-a', 'job-b']);
  const leases = new ProjectWriteLeaseRepository(testDb.db);

  const expired = leases.acquire({
    projectId: fixtureProjectId,
    jobId: 'job-a',
    ownerId: 'worker-a',
    ttlMs: 1_000,
    now: instant('2026-07-16T09:00:00.000Z'),
  });
  const replacement = leases.acquire({
    projectId: fixtureProjectId,
    jobId: 'job-b',
    ownerId: 'worker-b',
    ttlMs: 30_000,
    now: instant('2026-07-16T09:00:01.000Z'),
  });

  assert.notEqual(replacement.id, expired.id);
  assert.equal(replacement.expiresAt, '2026-07-16T09:00:31.000Z');
  assert.throws(
    () => leases.renew({
      leaseId: expired.id,
      ownerId: 'worker-a',
      ttlMs: 30_000,
      now: instant('2026-07-16T09:00:02.000Z'),
    }),
    ProjectLeaseConflictError,
  );
});

it('renews a lease only for its owner using the supplied time', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  seedProjectAndJobs(testDb.db, ['job-a']);
  const leases = new ProjectWriteLeaseRepository(testDb.db);
  const lease = leases.acquire({
    projectId: fixtureProjectId,
    jobId: 'job-a',
    ownerId: 'worker-a',
    ttlMs: 30_000,
    now: instant('2026-07-16T09:00:00.000Z'),
  });

  assert.throws(
    () => leases.renew({
      leaseId: lease.id,
      ownerId: 'worker-b',
      ttlMs: 30_000,
      now: instant('2026-07-16T09:00:05.000Z'),
    }),
    ProjectLeaseConflictError,
  );
  assert.deepEqual(
    leases.renew({
      leaseId: lease.id,
      ownerId: 'worker-a',
      ttlMs: 30_000,
      now: instant('2026-07-16T09:00:05.000Z'),
    }),
    {
      ...lease,
      expiresAt: '2026-07-16T09:00:35.000Z',
      updatedAt: '2026-07-16T09:00:05.000Z',
    },
  );
});

it('releases a lease only for its owner', (t) => {
  const testDb = createTestDb();
  t.after(() => testDb.cleanup());
  seedProjectAndJobs(testDb.db, ['job-a', 'job-b']);
  const leases = new ProjectWriteLeaseRepository(testDb.db);
  const lease = leases.acquire({
    projectId: fixtureProjectId,
    jobId: 'job-a',
    ownerId: 'worker-a',
    ttlMs: 30_000,
    now: instant('2026-07-16T09:00:00.000Z'),
  });

  leases.release({ leaseId: lease.id, ownerId: 'worker-b' });
  assert.throws(
    () => leases.acquire({
      projectId: fixtureProjectId,
      jobId: 'job-b',
      ownerId: 'worker-b',
      ttlMs: 30_000,
      now: instant('2026-07-16T09:00:01.000Z'),
    }),
    ProjectLeaseConflictError,
  );

  leases.release({ leaseId: lease.id, ownerId: 'worker-a' });
  assert.equal(
    leases.acquire({
      projectId: fixtureProjectId,
      jobId: 'job-b',
      ownerId: 'worker-b',
      ttlMs: 30_000,
      now: instant('2026-07-16T09:00:01.000Z'),
    }).ownerId,
    'worker-b',
  );
});
