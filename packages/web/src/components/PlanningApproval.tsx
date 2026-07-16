import { useEffect, useState } from 'react';
import {
  api,
  approveBibleRevision,
  approveOutlines,
  getProjectOutlines,
  type BibleRaw,
  type OutlineListItem,
} from '../api/client.ts';

export interface PlanningApprovalProps {
  projectId: string;
  onApprovedChange?: (approved: boolean) => void;
}

function outlineIsApproved(outline: OutlineListItem): boolean {
  return outline.status === 'approved' || outline.status === 'writing' || outline.status === 'written';
}

export function PlanningApproval({ projectId, onApprovedChange }: PlanningApprovalProps) {
  const [bible, setBible] = useState<BibleRaw | null>(null);
  const [outlines, setOutlines] = useState<OutlineListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    Promise.allSettled([
      api<BibleRaw>(`/projects/${projectId}/bible/raw`),
      getProjectOutlines(projectId),
    ])
      .then(([bibleResult, outlineResult]) => {
        const nextBible = bibleResult.status === 'fulfilled' ? bibleResult.value : null;
        const nextOutlines = outlineResult.status === 'fulfilled' ? outlineResult.value.outlines : [];
        setBible(nextBible);
        setOutlines(nextOutlines);
        const approved = nextBible?.status === 'approved'
          && nextOutlines.length > 0
          && nextOutlines.every(outlineIsApproved);
        onApprovedChange?.(approved);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [projectId]);

  const approveBible = async () => {
    if (!bible?.revisionId) return;
    setActing('bible');
    setError('');
    try {
      await approveBibleRevision(projectId, bible.revisionId);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing('');
    }
  };

  const approveAllOutlines = async () => {
    if (outlines.length === 0) return;
    setActing('outlines');
    setError('');
    try {
      await approveOutlines(projectId, 1, outlines.length);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing('');
    }
  };

  const bibleApproved = bible?.status === 'approved';
  const outlineApprovedCount = outlines.filter(outlineIsApproved).length;
  const allOutlinesApproved = outlines.length > 0 && outlineApprovedCount === outlines.length;

  return (
    <div className="card">
      <h2>规划审批</h2>
      {loading && <div className="loading">检查规划状态...</div>}
      {error && <div className="error" style={{ marginBottom: 8 }}>{error}</div>}
      {!loading && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div>
              <strong>Bible</strong>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                {bible ? `revision #${bible.revisionNumber ?? '?'} · ${bible.status ?? 'unknown'}` : '尚未生成'}
              </div>
            </div>
            {bible && !bibleApproved && (
              <button className="btn btn-primary" onClick={approveBible} disabled={acting !== ''}>
                {acting === 'bible' ? '审批中...' : '批准 Bible'}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div>
              <strong>章节蓝图</strong>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                {outlines.length === 0
                  ? '尚未生成'
                  : `${outlineApprovedCount}/${outlines.length} 已批准`}
              </div>
            </div>
            {bibleApproved && outlines.length > 0 && !allOutlinesApproved && (
              <button className="btn btn-primary" onClick={approveAllOutlines} disabled={acting !== ''}>
                {acting === 'outlines' ? '审批中...' : '批准全部蓝图'}
              </button>
            )}
          </div>

          {bibleApproved && allOutlinesApproved && (
            <div style={{ color: 'var(--green)' }}>规划已批准，可以生成章节。</div>
          )}
        </div>
      )}
    </div>
  );
}
