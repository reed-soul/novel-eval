import { useEffect, useState } from 'react';
import {
  editChapterWithExtract,
  getChapterRevisions,
  type ChapterRevision,
} from '../api/client.ts';

export interface RevisionHistoryProps {
  projectId: string;
  chapterNumber: number;
  chapterId: string | null;
  onRestored?: () => void;
}

export function RevisionHistory({
  projectId,
  chapterNumber,
  chapterId,
  onRestored,
}: RevisionHistoryProps) {
  const [revisions, setRevisions] = useState<ChapterRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    if (!chapterId) return;
    setLoading(true);
    setError('');
    getChapterRevisions(chapterId)
      .then((res) => setRevisions(res.revisions))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [chapterId]);

  const restore = async (revision: ChapterRevision) => {
    if (!window.confirm(`恢复到 revision #${revision.revisionNumber}？这会发布一个新的手动修订。`)) return;
    setActingId(revision.id);
    setError('');
    try {
      await editChapterWithExtract(projectId, chapterNumber, {
        title: revision.title,
        content: revision.content,
      });
      load();
      onRestored?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingId(null);
    }
  };

  if (!chapterId) return null;

  return (
    <div className="card">
      <h2>修订历史</h2>
      {loading && <div className="loading">加载修订...</div>}
      {error && <div className="error" style={{ marginBottom: 8 }}>{error}</div>}
      {!loading && revisions.length === 0 && <div className="empty">暂无修订。</div>}
      {revisions.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {revisions.map((revision) => (
            <div
              key={revision.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 12,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <div>
                <strong>#{revision.revisionNumber} {revision.title}</strong>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                  {revision.source} · {revision.wordCount} 字 · {new Date(revision.createdAt).toLocaleString()}
                  {revision.active ? ' · 当前发布' : ''}
                </div>
              </div>
              <button
                className="btn"
                onClick={() => restore(revision)}
                disabled={revision.active || actingId !== null}
              >
                {actingId === revision.id ? '恢复中...' : '恢复'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
