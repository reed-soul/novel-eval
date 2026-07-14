/**
 * 修正预览页 — 触发经验驱动的局部修正，展示 diff，采纳/放弃
 *
 * 流程：
 *   1. 进入页面 → 触发 POST /correct 拿 jobId
 *   2. useJobProgress 订阅 SSE 显示进度
 *   3. done → 拉取 pending draft → 左右分栏 diff + 分数对比 + 改动点
 *   4. 采纳（覆盖原文 + 反哺经验）/ 放弃（无副作用）
 */
import { useState, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  correctChapter, getPendingCorrection, adoptCorrection, discardCorrection,
  type CorrectionDraft,
} from '../api/client.ts';
import { useJobProgress } from '../hooks/useJobProgress.ts';

export function CorrectionReview() {
  const { id, n } = useParams<{ id: string; n: string }>();
  const navigate = useNavigate();
  const chapterNumber = n ? parseInt(n, 10) : NaN;

  const [jobId, setJobId] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState('');
  const [draft, setDraft] = useState<CorrectionDraft | null>(null);
  const [draftError, setDraftError] = useState('');
  const [acting, setActing] = useState(false);
  const [checkingPending, setCheckingPending] = useState(true);

  const { events, status, result } = useJobProgress(jobId);

  const startCorrection = () => {
    setTriggerError('');
    setDraftError('');
    setDraft(null);
    setJobId(null);
    correctChapter(id!, chapterNumber)
      .then((res) => setJobId(res.jobId))
      .catch((e: unknown) => setTriggerError(e instanceof Error ? e.message : String(e)));
  };

  // 进入页面检查 pending 状态或自动触发
  useEffect(() => {
    if (!id || isNaN(chapterNumber)) return;
    setCheckingPending(true);
    getPendingCorrection(id, chapterNumber)
      .then((res) => {
        if (res.draft) {
          setDraft(res.draft);
        } else {
          startCorrection();
        }
      })
      .catch(() => {
        startCorrection();
      })
      .finally(() => setCheckingPending(false));
  }, [id, chapterNumber]);

  // job 完成 → 拉草稿
  useEffect(() => {
    if (status !== 'done' || !id || isNaN(chapterNumber)) return;
    getPendingCorrection(id, chapterNumber)
      .then((res) => {
        if (!res.draft) setDraftError('未找到修正草稿');
        else setDraft(res.draft);
      })
      .catch((e: unknown) => setDraftError(e instanceof Error ? e.message : String(e)));
  }, [status, id, chapterNumber]);

  // 错误结果（job 报错）
  useEffect(() => {
    if (status === 'error' && result) setDraftError(String(result));
  }, [status, result]);

  const onAdopt = async () => {
    if (!id || !draft) return;
    setActing(true);
    try {
      await adoptCorrection(id, draft.id);
      navigate(`/projects/${id}/chapters/${chapterNumber}`);
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  };

  const onDiscard = async () => {
    if (!id || !draft) return;
    setActing(true);
    try {
      await discardCorrection(id, draft.id);
      navigate(`/projects/${id}/chapters/${chapterNumber}`);
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  };

  // ─── 渲染分支 ───────────────────────────────────────────────────

  if (checkingPending) {
    return <div className="container loading">正在检查历史草稿...</div>;
  }

  if (triggerError) {
    return (
      <div className="container error">
        <h2>触发修正失败</h2>
        <p>{triggerError}</p>
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button className="btn btn-primary" onClick={startCorrection}>🔄 重新尝试</button>
          <Link to={`/projects/${id}/chapters/${n}`} className="back-link" style={{ alignSelf: 'center' }}>← 返回章节</Link>
        </div>
      </div>
    );
  }

  // 进行中
  if (status !== 'done' && status !== 'error' && (jobId || status !== 'idle')) {
    return (
      <div className="container">
        <div className="page-header">
          <div>
            <h2>正在修正第 {n} 章…</h2>
            <div className="project-subheading">基于历史评估经验做针对性局部修正</div>
          </div>
          <Link to={`/projects/${id}/chapters/${n}`} className="back-link">← 返回章节</Link>
        </div>
        <div className="card">
          <div className="job-progress">
            {events.length === 0 && !jobId && <div className="loading">准备中...</div>}
            {events.map((e, i) => (
              <div key={i} className="progress-line">
                <span className="progress-step">[{e.step}]</span> {e.msg}
              </div>
            ))}
            {jobId && events.length === 0 && <div className="loading">已提交，等待引擎响应...</div>}
          </div>
        </div>
      </div>
    );
  }

  if (draftError) {
    return (
      <div className="container error">
        <h2>修正出错</h2>
        <p>{draftError}</p>
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button className="btn btn-primary" onClick={startCorrection}>🔄 重新尝试</button>
          <Link to={`/projects/${id}/chapters/${n}`} className="back-link" style={{ alignSelf: 'center' }}>← 返回章节</Link>
        </div>
      </div>
    );
  }

  if (!draft) {
    return <div className="container loading">加载修正结果...</div>;
  }

  const scoreDelta = (draft.revisedScore ?? 0) - (draft.originalScore ?? 0);
  const scoreDown = draft.originalScore != null && draft.revisedScore != null && scoreDelta < 0;

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h2>修正预览 · 第 {draft.chapterNumber} 章</h2>
          <div className="project-subheading">
            策略：<strong>{draft.strategy === 'surgical' ? '🔬 外科手术式局部改写' : '✍️ 整章重写'}</strong>
            {draft.revisedScore != null && (
              <span style={{ marginLeft: 16 }}>
                分数：
                {draft.originalScore != null ? (
                  <>
                    <strong>{draft.originalScore}</strong> →{' '}
                  </>
                ) : (
                  <span>未达标 → </span>
                )}
                <strong style={{ color: scoreDown ? 'var(--danger, #e5484d)' : 'var(--success, #30a46c)' }}>
                  {draft.revisedScore}
                </strong>
                {draft.originalScore != null && (
                  <span style={{ marginLeft: 4, color: scoreDown ? 'var(--danger, #e5484d)' : 'var(--success, #30a46c)' }}>
                    ({scoreDelta > 0 ? '+' : ''}{scoreDelta})
                  </span>
                )}
                {scoreDown && <span style={{ marginLeft: 8, color: 'var(--danger, #e5484d)' }}>⚠️ 分数下降，请谨慎采纳</span>}
              </span>
            )}
          </div>
        </div>
        <Link to={`/projects/${id}/chapters/${n}`} className="back-link">← 返回章节</Link>
      </div>

      {/* 改动点说明（仅 surgical）*/}
      {draft.strategy === 'surgical' && draft.changes.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>改动说明（{draft.changes.length} 处）</h3>
          <div style={{ marginTop: 8 }}>
            {draft.changes.map((ch, i) => (
              <div key={i} className="change-item" style={{ marginBottom: 8, fontSize: 14, lineHeight: 1.7 }}>
                <span style={{ color: 'var(--danger, #e5484d)' }}>原文：「{ch.original}」</span>
                {' → '}
                <span style={{ color: 'var(--success, #30a46c)' }}>改为：「{ch.revised}」</span>
                {ch.reason && <span style={{ color: 'var(--text-muted, #8b8d98)', marginLeft: 8 }}>｜{ch.reason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 诊断问题清单 */}
      {draft.issues.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>诊断出的问题（{draft.issues.length}）</h3>
          <div style={{ marginTop: 8 }}>
            {draft.issues.map((iss, i) => (
              <div key={i} style={{ marginBottom: 6, fontSize: 14 }}>
                <span className="badge" style={{
                  marginRight: 8, padding: '2px 8px', borderRadius: 4, fontSize: 12,
                  background: iss.type === 'surgical' ? 'var(--accent-soft, #e5e5ff)' : 'var(--warning-soft, #fff4d6)',
                }}>{iss.dimensionLabel}（{iss.score}）</span>
                {iss.lessonRef && <span style={{ color: 'var(--text-muted, #8b8d98)' }}>{iss.lessonRef}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 左右分栏 diff */}
      <div className="card">
        <h3>正文对比</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-muted, #8b8d98)' }}>原文</div>
            <div
              className="chapter-content"
              style={{ maxHeight: '60vh', overflow: 'auto', fontSize: 14, lineHeight: 1.9, opacity: 0.85 }}
            >{draft.originalContent}</div>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--success, #30a46c)' }}>修正稿</div>
            <div
              className="chapter-content"
              style={{ maxHeight: '60vh', overflow: 'auto', fontSize: 14, lineHeight: 1.9 }}
            >{draft.revisedContent}</div>
          </div>
        </div>
      </div>

      {/* 操作栏 */}
      <div style={{ display: 'flex', gap: 12, marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={startCorrection} disabled={acting}>🔄 重新修正</button>
        <button className="btn" onClick={onDiscard} disabled={acting}>❌ 放弃</button>
        <button className="btn btn-primary" onClick={onAdopt} disabled={acting}>
          {acting ? '处理中...' : '✅ 采纳'}
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted, #8b8d98)', marginTop: 8, textAlign: 'right' }}>
        采纳后将覆盖原文、记录评估历史并重新聚合写作经验
      </p>
    </div>
  );
}
