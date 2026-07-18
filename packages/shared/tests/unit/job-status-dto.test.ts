import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseJobStatusResponse } from '../../src/dto/jobs.ts';

describe('parseJobStatusResponse', () => {
  it('accepts rebuild, edit, and auto job types', () => {
    for (const type of ['rebuild', 'edit', 'auto'] as const) {
      const parsed = parseJobStatusResponse({
        id: 'job-1',
        type,
        projectId: 'proj-1',
        status: 'running',
      });
      assert.equal(parsed.ok, true);
      if (parsed.ok) assert.equal(parsed.data.type, type);
    }
  });

  it('accepts queued status from durable job rows', () => {
    const parsed = parseJobStatusResponse({
      id: 'job-2',
      type: 'chapter',
      projectId: 'proj-1',
      status: 'queued',
      fromChapter: 1,
      toChapter: 3,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.data.status, 'queued');
      assert.equal(parsed.data.fromChapter, 1);
      assert.equal(parsed.data.toChapter, 3);
    }
  });

  it('rejects unknown job types', () => {
    const parsed = parseJobStatusResponse({
      id: 'job-3',
      type: 'unknown',
      projectId: 'proj-1',
      status: 'running',
    });
    assert.equal(parsed.ok, false);
  });
});
