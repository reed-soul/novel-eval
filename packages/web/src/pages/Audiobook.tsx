/**
 * 有声书工作台 — 总览页
 *
 * 版本（制作 run）切换 → 集卡片墙（缩略图/时长/QA 状态/缺件）→
 * 构建新集（表单）与审听（参数条）都从这发起，底部 Job 控制台直播 CLI 输出。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiPost } from '../api/client.ts';

export interface AbRun {
  id: string; label: string; bookTitle: string;
  episodeCount: number; sceneImageCount: number;
  hasListenReport: boolean; updatedAt: string;
}
export interface AbEpisode {
  ep: number; id: string; title: string; durationMs: number | null;
  hasVideo: boolean; hasAudio: boolean; hasSrt: boolean;
  chapters: { pos: number; title: string; segments: number; attributed: number }[];
  thumbnailUrl: string | null;
  qa: { ok: number; suspect: number; bad: number; missing: number; silent: number } | null;
}
interface AbRunDetail extends AbRun {
  episodes: AbEpisode[];
  sceneUrlsByChapter: Record<string, string[]>;
}
interface AbJobInfo { jobId: string; args: string[] }
interface JobLine { seq: number; text: string }

export function fmtDur(ms: number | null): string {
  if (!ms) return '--:--';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}

function qaLevel(qa: AbEpisode['qa']): { cls: string; text: string } {
  if (!qa) return { cls: 'ab-chip ab-chip-muted', text: '未审听' };
  const p0 = qa.bad + qa.missing + qa.silent;
  if (p0 === 0 && qa.suspect === 0) return { cls: 'ab-chip ab-chip-green', text: `QA 全过 ${qa.ok}段` };
  if (p0 === 0) return { cls: 'ab-chip ab-chip-amber', text: `suspect ${qa.suspect}` };
  return { cls: 'ab-chip ab-chip-red', text: `P0 ${p0}｜suspect ${qa.suspect}` };
}

/** Job 控制台：SSE 直播 CLI 输出；完成/失败后回调刷新 */
function JobConsole({ job, onDone, onClose }: { job: AbJobInfo; onDone?: (ok: boolean) => void; onClose: () => void }) {
  const [lines, setLines] = useState<JobLine[]>([]);
  const [status, setStatus] = useState<'running' | 'completed' | 'failed' | 'cancelled'>('running');
  const boxRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const es = new EventSource(`/api/audiobook/jobs/${job.jobId}/stream`);
    es.onmessage = (ev) => {
      try { setLines((prev) => [...prev.slice(-400), JSON.parse(ev.data) as JobLine]); } catch { /* 忽略心跳等 */ }
    };
    es.addEventListener('done', (ev) => {
      try {
        const d = JSON.parse((ev as MessageEvent).data) as { status?: string };
        setStatus((d.status as typeof status) ?? 'completed');
      } catch { setStatus('completed'); }
      es.close();
      if (!doneRef.current) { doneRef.current = true; onDone?.(status !== 'failed'); }
    });
    es.onerror = () => { /* 断链由浏览器自动重连；终态由 done 事件驱动 */ };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.jobId]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [lines]);

  const cancel = async () => {
    await apiPost(`/api/audiobook/jobs/${job.jobId}/cancel`).catch(() => undefined);
  };

  return (
    <div className="ab-job-console">
      <div className="ab-job-head">
        <span className={`ab-chip ${status === 'running' ? 'ab-chip-amber' : status === 'completed' ? 'ab-chip-green' : 'ab-chip-red'}`}>
          {status === 'running' ? <><span className="ab-pulse-dot" /> 运行中</> : status === 'completed' ? <><span className="msr msr-sm">check_circle</span> 完成</> : status === 'cancelled' ? '已取消' : <><span className="msr msr-sm">error</span> 失败</>}
        </span>
        <code className="ab-job-cmd">pnpm audiobook {job.args.join(' ')}</code>
        <span className="ab-job-sp" />
        {status === 'running' && <button className="ab-btn ab-btn-danger" onClick={cancel}><span className="msr msr-sm">stop_circle</span> 取消</button>}
        {status !== 'running' && <button className="ab-btn" onClick={onClose}>关闭</button>}
      </div>
      <div className="ab-job-lines" ref={boxRef}>
        {lines.map((l) => <div key={l.seq} className={`ab-job-line ${lineLevel(l.text)}`}>{l.text}</div>)}
      </div>
    </div>
  );
}

/** 控制台日志分级着色（借鉴 Stitch 稿的 [WARN]/[INFO] 处理；按实际输出特征匹配） */
function lineLevel(text: string): string {
  if (/✅|完成。|▶ 完成/.test(text)) return 'lvl-ok';
  if (/⚠|失败|✗/.test(text)) return 'lvl-warn';
  if (/▶|\[EP\d+\]/.test(text)) return 'lvl-info';
  return '';
}

export function Audiobook() {
  const [runs, setRuns] = useState<AbRun[]>([]);
  const [runId, setRunId] = useState<string>('');
  const [detail, setDetail] = useState<AbRunDetail | null>(null);
  const [job, setJob] = useState<AbJobInfo | null>(null);
  const [showBuild, setShowBuild] = useState(false);
  const [listenEp, setListenEp] = useState('');
  const [listenFix, setListenFix] = useState(false);
  const [listenSrt, setListenSrt] = useState(false);
  const [err, setErr] = useState('');

  const loadRuns = useCallback(async () => {
    const rs = await api<AbRun[]>('/audiobook/runs');
    setRuns(rs);
    if (rs.length && !rs.some((r) => r.id === runId)) setRunId((prev) => prev || rs[0].id);
  }, [runId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetail(await api<AbRunDetail>(`/audiobook/runs/${id}`));
  }, []);

  useEffect(() => { void loadRuns().catch((e) => setErr(String(e))); }, [loadRuns]);
  useEffect(() => { if (runId) void loadDetail(runId).catch((e) => setErr(String(e))); }, [runId, loadDetail]);

  const startJob = async (payload: Record<string, unknown>) => {
    setErr('');
    try {
      const r = await apiPost<AbJobInfo>('/audiobook/jobs', payload);
      setJob(r);
      setShowBuild(false);
    } catch (e) {
      setErr(String((e as Error).message));
    }
  };

  return (
    <div className="ab-page">
      <header className="ab-hero">
        <div>
          <h1 className="ab-hero-title">有声书工作台</h1>
          <p className="ab-hero-sub">
            {detail ? <>《{detail.bookTitle}》· 制作版本 <b>{detail.label}</b> · {detail.episodeCount} 集 · 场景图 {detail.sceneImageCount} 张</> : '加载中…'}
          </p>
        </div>
        <div className="ab-hero-actions">
          <button className="ab-btn ab-btn-primary" onClick={() => setShowBuild((v) => !v)}><span className="msr msr-sm">add_circle</span> 构建新集</button>
          <button
            className="ab-btn"
            title="whisper 逐段回验，产出 listen-report（只报告不动文件）"
            onClick={() => void startJob({ action: 'listen', out: runId, ...(listenEp ? { ep: listenEp } : {}) })}
          >
            <span className="msr msr-sm">hearing</span> 审听本版本
          </button>
        </div>
      </header>

      {runs.length > 1 && (
        <div className="ab-run-switch">
          {runs.map((r) => (
            <button key={r.id} className={`ab-run-pill ${r.id === runId ? 'active' : ''}`} onClick={() => setRunId(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      )}

      {showBuild && <BuildForm sceneRuns={runs} onCancel={() => setShowBuild(false)} onSubmit={(o) => void startJob({ action: 'build', out: runId, ...o })} />}

      <div className="ab-listen-bar">
        <span className="ab-listen-label">审听选项：</span>
        <input className="ab-input ab-input-mini" placeholder="集号 如 1" value={listenEp} onChange={(e) => setListenEp(e.target.value.replace(/[^\d]/g, ''))} />
        <label className="ab-check"><input type="checkbox" checked={listenFix} onChange={(e) => setListenFix(e.target.checked)} />fix（删坏段缓存促重合成）</label>
        <label className="ab-check"><input type="checkbox" checked={listenSrt} onChange={(e) => setListenSrt(e.target.checked)} />srt 重对齐</label>
      </div>

      {err && <div className="ab-error">{err}</div>}

      <div className="ab-ep-grid">
        {(detail?.episodes ?? []).map((ep) => {
          const qa = qaLevel(ep.qa);
          return (
            <Link key={ep.id} to={`/audiobook/${runId}/${ep.ep}`} className="ab-ep-card">
              <div className="ab-ep-thumb">
                {ep.thumbnailUrl
                  ? <img src={ep.thumbnailUrl} alt={`EP${ep.ep} 缩略图`} loading="lazy" />
                  : <div className="ab-ep-thumb-fallback">🎧</div>}
                <span className="ab-ep-no">EP{String(ep.ep).padStart(2, '0')}</span>
                <span className="ab-ep-dur"><span className="msr msr-sm">schedule</span>{fmtDur(ep.durationMs)}</span>
              </div>
              <div className="ab-ep-body">
                <div className="ab-ep-title">{ep.title.replace(/^【有声书】.*?EP\d+｜/, '')}</div>
                <div className="ab-ep-meta">
                  <span className="ab-chip ab-chip-muted">{ep.chapters.length} 章</span>
                  {!ep.hasVideo && <span className="ab-chip ab-chip-red">缺视频</span>}
                  {!ep.hasAudio && <span className="ab-chip ab-chip-red">缺音频</span>}
                  {!ep.hasSrt && <span className="ab-chip ab-chip-amber">缺字幕</span>}
                  <span className={qa.cls}>{qa.text}</span>
                </div>
              </div>
            </Link>
          );
        })}
        {detail && detail.episodes.length === 0 && (
          <div className="ab-empty">该版本还没有集。点右上「构建新集」跑第一条：建议先 --chars 600 试产样品。</div>
        )}
        {detail && detail.episodes.length > 0 && (
          <button className="ab-ep-card ab-ep-ghost" onClick={() => setShowBuild(true)}>
            <span className="msr">add_circle</span>
            <span className="ab-ghost-title">等待构建</span>
            <span className="ab-ghost-hint">下一集从这里开始</span>
          </button>
        )}
      </div>

      {job && (
        <JobConsole
          job={job}
          onDone={() => { void loadRuns(); if (runId) void loadDetail(runId); }}
          onClose={() => setJob(null)}
        />
      )}
    </div>
  );
}

function BuildForm({ onSubmit, onCancel, sceneRuns }: { onSubmit: (o: Record<string, unknown>) => void; onCancel: () => void; sceneRuns: AbRun[] }) {
  const [project, setProject] = useState('最后一班森铁');
  const [chapters, setChapters] = useState('1');
  const [group, setGroup] = useState('3');
  const [engine, setEngine] = useState('edge');
  const [chars, setChars] = useState('');
  const [epStart, setEpStart] = useState('1');
  const [noVideo, setNoVideo] = useState(false);
  const [coverRun, setCoverRun] = useState('');

  return (
    <div className="ab-build-form">
      <div className="ab-build-row">
        <label>项目<input className="ab-input" value={project} onChange={(e) => setProject(e.target.value)} /></label>
        <label>章节<input className="ab-input ab-input-mini" value={chapters} onChange={(e) => setChapters(e.target.value)} placeholder="1 或 1-15" /></label>
        <label>并章/集
          <select className="ab-input" value={group} onChange={(e) => setGroup(e.target.value)}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>引擎
          <select className="ab-input" value={engine} onChange={(e) => setEngine(e.target.value)}>
            <option value="edge">edge（免费）</option>
            <option value="volcengine">volcengine（豆包班底）</option>
          </select>
        </label>
        <label>试产字数<input className="ab-input ab-input-mini" value={chars} onChange={(e) => setChars(e.target.value.replace(/[^\d]/g, ''))} placeholder="空=全章" /></label>
        <label>起始集号<input className="ab-input ab-input-mini" value={epStart} onChange={(e) => setEpStart(e.target.value.replace(/[^\d]/g, ''))} /></label>
        <label>场景图
          <select className="ab-input" value={coverRun} onChange={(e) => setCoverRun(e.target.value)}>
            <option value="">无（纯音频视频将跳过）</option>
            {sceneRuns.filter((r) => r.sceneImageCount > 0).map((r) => (
              <option key={r.id} value={r.id}>{r.label} 的 scenes（{r.sceneImageCount} 张）</option>
            ))}
          </select>
        </label>
        <label className="ab-check"><input type="checkbox" checked={noVideo} onChange={(e) => setNoVideo(e.target.checked)} />跳过视频渲染</label>
      </div>
      <div className="ab-build-actions">
        <span className="ab-hint">首次建议：章节 1、字数 600，先听样品再全量。串行执行，跑时可在下方控制台看直播。</span>
        <button className="ab-btn" onClick={onCancel}>取消</button>
        <button
          className="ab-btn ab-btn-primary"
          onClick={() => onSubmit({ project, chapters, group, engine, ...(chars ? { chars } : {}), ...(epStart ? { epStart } : {}), noVideo, ...(coverRun ? { coverRun } : {}) })}
        >
          启动构建
        </button>
      </div>
    </div>
  );
}
