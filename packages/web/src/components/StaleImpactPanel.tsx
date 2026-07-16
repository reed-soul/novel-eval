import { useEffect, useState } from 'react';
import {
  getStaleImpact,
  rebuildStoryState,
  type StaleImpactResponse,
} from '../api/client.ts';

export interface StaleImpactPanelProps {
  projectId: string;
  fromOutlinePosition?: number;
  onRebuilt?: () => void;
}

export function StaleImpactPanel({ projectId, fromOutlinePosition, onRebuilt }: StaleImpactPanelProps) {
  const [impact, setImpact] = useState<StaleImpactResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    getStaleImpact(projectId, fromOutlinePosition)
      .then(setImpact)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [projectId, fromOutlinePosition]);

  const rebuild = async () => {
    if (!impact) return;
    setActing(true);
    setError('');
    try {
      await rebuildStoryState(projectId, { fromOutlinePosition: impact.fromOutlinePosition });
      load();
      onRebuilt?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  };

  const affected = impact?.affectedOutlinePositions ?? [];

  return (
    <div className="card">
      <h2>状态影响</h2>
      {loading && <div className="loading">检查下游状态...</div>}
      {error && <div className="error" style={{ marginBottom: 8 }}>{error}</div>}
      {!loading && !error && affected.length === 0 && (
        <div className="empty">没有待重建的下游章节状态。</div>
      )}
      {affected.length > 0 && (
        <>
          <p style={{ lineHeight: 1.7 }}>
            以下章节的 story state 已过期：{affected.map((n) => `第 ${n} 章`).join('、')}
          </p>
          <button className="btn btn-primary" onClick={rebuild} disabled={acting}>
            {acting ? '重建中...' : `重建第 ${impact?.fromOutlinePosition ?? fromOutlinePosition ?? 1} 章起的状态`}
          </button>
        </>
      )}
    </div>
  );
}
