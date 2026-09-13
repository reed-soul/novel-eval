/**
 * 书内·短篇 tab（M2）：精简短篇（digest）工作台——第二真衍生形态。
 * 生成表单（章节范围/标题/目标字数/风格）+ 条目列表（展开阅读）+ 进度轮询。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, apiPost } from '../api/client.ts';
import { BookTabs } from '../components/BookTabs.tsx';

interface Piece {
  id: string; title: string; chapters: [number, number];
  words: number; style: string; createdAt: string;
}

interface DigestStatus {
  registered: boolean;
  title: string;
  presets: { style: string; targetWords: number } | null;
  pieces: Piece[];
}

interface DigestJob {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  phase: string;
  error?: string;
  pieceId?: string;
  elapsedSec?: number;
}

const STYLE_LABEL: Record<string, string> = { faithful: '忠实浓缩', hook: '引流浓缩' };

export function BookDigest() {
  const { id: bookId = '' } = useParams();
  const [st, setSt] = useState<DigestStatus | null>(null);
  const [err, setErr] = useState('');
  const [job, setJob] = useState<DigestJob | null>(null);
  const [reading, setReading] = useState<{ id: string; title: string; markdown: string } | null>(null);

  const [chapters, setChapters] = useState('');
  const [title, setTitle] = useState('');
  const [targetWords, setTargetWords] = useState('3000');
  const [style, setStyle] = useState('faithful');

  const load = useCallback(async () => {
    try {
      setSt(await api<DigestStatus>(`/digest/books/${bookId}`));
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [bookId]);

  useEffect(() => { void load(); }, [load]);

  // 任务轮询：running 时每 2s 拉进度，完成/失败刷新列表
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const t = setInterval(() => {
      api<DigestJob>(`/digest/jobs/${job.jobId}`)
        .then((j) => {
          setJob(j);
          if (j.status !== 'running') void load();
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [job, load]);

  const start = async () => {
    setErr('');
    try {
      const r = await apiPost<{ jobId: string }>(`/digest/books/${bookId}/jobs`, {
        chapters: chapters.trim(), title: title.trim(),
        targetWords: Number(targetWords) || 3000, style,
      });
      setJob({ jobId: r.jobId, status: 'running', phase: '准备章节' });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const openPiece = async (pid: string) => {
    try {
      setReading(await api<{ id: string; title: string; markdown: string }>(`/digest/books/${bookId}/piece/${pid}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (err && !st) return <div className="ab-page"><BookTabs active="digest" /><div className="ab-error">{err}</div></div>;
  if (!st) return <div className="ab-page"><BookTabs active="digest" /><div className="ab-empty">加载中…</div></div>;

  return (
    <div className="ab-page">
      <BookTabs active="digest" />

      <header className="ab-hero">
        <div>
          <h1 className="ab-hero-title">《{st.title}》· 精简短篇</h1>
          <p className="ab-hero-sub">
            {st.pieces.length} 篇 · 把选定章节浓缩成节奏紧凑的短篇（忠实/引流两种风格）{st.presets ? ` · 默认 ${STYLE_LABEL[st.presets.style] ?? st.presets.style} / 约 ${st.presets.targetWords} 字` : ''}
          </p>
        </div>
      </header>

      {/* 生成表单 */}
      <div className="ab-next-card">
        <div className="ab-next-main">
          <div className="ab-next-title">生成一篇短篇</div>
          <div className="ab-next-meta">从章节浓缩：保留主线与关键反转，删去枝节；改章重生成只重浓缩改动的章（内容哈希缓存）</div>
          <div className="ab-config-grid" style={{ marginTop: 10 }}>
            <label>章节范围（如 1-9）
              <input className="ab-input" value={chapters} onChange={(e) => setChapters(e.target.value)} placeholder="1-9" />
            </label>
            <label>标题
              <input className="ab-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="给这篇短篇起个名字" />
            </label>
            <label>目标字数
              <input className="ab-input ab-input-mini" value={targetWords} onChange={(e) => setTargetWords(e.target.value)} />
            </label>
            <label>风格
              <select className="ab-input" value={style} onChange={(e) => setStyle(e.target.value)}>
                <option value="faithful">忠实浓缩（保留完整主线）</option>
                <option value="hook">引流浓缩（强钩子快节奏）</option>
              </select>
            </label>
          </div>
        </div>
        <div className="ab-next-actions">
          <button
            className="ab-btn ab-btn-primary"
            disabled={!chapters.trim() || !title.trim() || job?.status === 'running'}
            onClick={() => void start()}
          >
            <span className="msr msr-sm">auto_awesome</span> {job?.status === 'running' ? '生成中…' : '开始生成'}
          </button>
        </div>
      </div>

      {job && (
        <div className={`ab-listen-bar ${job.status === 'failed' ? 'ab-error' : ''}`}>
          {job.status === 'running'
            ? <><span className="ab-pulse-dot" /> {job.phase}（{job.elapsedSec ?? 0}s）</>
            : job.status === 'completed'
              ? <><span className="msr msr-sm">check_circle</span> {job.phase}</>
              : <><span className="msr msr-sm">error</span> {job.error}</>}
          {job.status !== 'running' && <button className="ab-btn" onClick={() => setJob(null)}>关闭</button>}
        </div>
      )}

      {err && <div className="ab-error">{err}</div>}

      {/* 条目列表 */}
      <div className="ab-ep-grid">
        {st.pieces.map((p) => (
          <div key={p.id} className="ab-ep-card" role="button" tabIndex={0} onClick={() => void openPiece(p.id)} onKeyDown={(e) => e.key === 'Enter' && void openPiece(p.id)}>
            <div className="ab-ep-thumb"><div className="ab-ep-thumb-fallback"><span className="msr">description</span></div>
              <span className="ab-ep-no">{p.id.toUpperCase()}</span>
              <span className="ab-ep-dur"><span className="msr msr-sm">text_fields</span>{p.words} 字</span>
            </div>
            <div className="ab-ep-body">
              <div className="ab-ep-title">{p.title}</div>
              <div className="ab-ep-meta">
                <span className="ab-chip ab-chip-muted">第 {p.chapters[0]}–{p.chapters[1]} 章</span>
                <span className="ab-chip ab-chip-indigo">{STYLE_LABEL[p.style] ?? p.style}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {st.pieces.length === 0 && <div className="ab-empty">还没有短篇——填上面的表单生成第一篇。</div>}

      {/* 阅读视图 */}
      {reading && (
        <div className="ab-lightbox" onClick={() => setReading(null)}>
          <div className="dg-reader" onClick={(e) => e.stopPropagation()}>
            <div className="dg-reader-head">
              <h2>{reading.title}</h2>
              <button className="ab-btn" onClick={() => setReading(null)}><span className="msr msr-sm">close</span> 关闭</button>
            </div>
            <pre className="dg-reader-body">{reading.markdown}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
