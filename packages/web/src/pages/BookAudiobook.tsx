/**
 * 书内·有声书工作台（M0 重构版）
 *
 * 冷启动（未建线）→ 建线卡（一键开启并制作第 1 集）；
 * 已建线 → 「制作下一集」智能 CTA（人话确认条+成本行）+ 集墙（文件派生状态）+
 * 集卡操作（审听本集 / 重制 / 强制重制清缓存）+ 底部 Job 控制台。
 * 版本概念（v3/v4）与 CLI 参数不出现在任何 UI。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiPost } from '../api/client.ts';
import { BookTabs } from '../components/BookTabs.tsx';
import { CopyButton } from '../components/CopyButton.tsx';

interface EpisodeCard {
  ep: number; id: string;
  chapters: [number, number] | null;
  isDraft: boolean;
  title: string;
  durationMs: number | null;
  state: 'draft' | 'audio-ready' | 'video-ready' | 'audited';
  qa: { ok: number; suspect: number; bad: number; missing: number; silent: number } | null;
  thumbnailUrl: string | null;
}

interface BookStatus {
  registered: boolean;
  bookId: string;
  title: string;
  suggestion?: { engine: string; chaptersPerEpisode: number; skipVideo: boolean };
  presets?: { engine: string; chaptersPerEpisode: number; skipVideo: boolean };
  scenesPresent?: boolean;
  episodes?: EpisodeCard[];
  next?: { ep: number; chapters: [number, number]; chars: number };
  playlistMaterial?: {
    platform: string;
    title: string;
    description: string;
    tags: string[];
    tagsString: string;
  };
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

const ENGINE_LABEL: Record<string, string> = { edge: 'Edge（免费）', volcengine: '豆包班底', minimax: 'MiniMax' };

/** 成本预估：中文朗读 ≈400 字/分钟；volcengine 按 ≈¥2/万字 估（edge 免费） */
function costLine(chars: number, engine: string): string {
  if (!chars) return '章节范围无内容';
  const minutes = Math.round(chars / 400);
  const yuan = engine === 'edge' ? '免费' : `约 ¥${((chars / 10000) * 2).toFixed(1)}`;
  return `约 ${(chars / 10000).toFixed(1)} 万字 · 预计 ${minutes} 分钟成片 · ${yuan}`;
}

/** Job 控制台（M0 修复：终态用事件数据而非闭包旧值） */
function JobConsole({ job, onDone, onClose }: { job: AbJobInfo; onDone?: () => void; onClose: () => void }) {
  const [lines, setLines] = useState<JobLine[]>([]);
  const [status, setStatus] = useState<'running' | 'completed' | 'failed' | 'cancelled'>('running');
  const boxRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const es = new EventSource(`/api/audiobook/jobs/${job.jobId}/stream`);
    es.onmessage = (ev) => {
      try { setLines((prev) => [...prev.slice(-400), JSON.parse(ev.data) as JobLine]); } catch { /* 心跳等 */ }
    };
    es.addEventListener('done', (ev) => {
      let final: typeof status = 'completed';
      try {
        const d = JSON.parse((ev as MessageEvent).data) as { status?: string };
        if (d.status === 'failed' || d.status === 'cancelled' || d.status === 'completed') final = d.status;
      } catch { /* 默认 completed */ }
      setStatus(final);
      es.close();
      if (!doneRef.current) { doneRef.current = true; onDone?.(); }
    });
    es.onerror = () => { /* 浏览器自动重连；终态由 done 事件驱动 */ };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.jobId]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [lines]);

  const lineLevel = (text: string): string => {
    if (/✅|完成。|▶ 完成/.test(text)) return 'lvl-ok';
    if (/⚠|失败|✗/.test(text)) return 'lvl-warn';
    if (/▶|\[EP\d+\]/.test(text)) return 'lvl-info';
    return '';
  };

  return (
    <div className="ab-job-console">
      <div className="ab-job-head">
        <span className={`ab-chip ${status === 'running' ? 'ab-chip-amber' : status === 'completed' ? 'ab-chip-green' : 'ab-chip-red'}`}>
          {status === 'running' ? <><span className="ab-pulse-dot" /> 制作中</> : status === 'completed' ? <><span className="msr msr-sm">check_circle</span> 完成</> : status === 'cancelled' ? '已取消' : <><span className="msr msr-sm">error</span> 失败</>}
        </span>
        <span className="ab-job-plain">{job.args.filter((a) => !a.startsWith('--')).slice(0, 4).join(' · ')}</span>
        <span className="ab-job-sp" />
        {status === 'running' && (
          <button className="ab-btn ab-btn-danger" onClick={() => void apiPost(`/audiobook/jobs/${job.jobId}/cancel`).catch(() => undefined)}>
            <span className="msr msr-sm">stop_circle</span> 取消
          </button>
        )}
        {status !== 'running' && <button className="ab-btn" onClick={onClose}>关闭</button>}
      </div>
      <div className="ab-job-lines" ref={boxRef}>
        {lines.map((l) => <div key={l.seq} className={`ab-job-line ${lineLevel(l.text)}`}>{l.text}</div>)}
      </div>
    </div>
  );
}

function stateChip(ep: EpisodeCard, skipVideo: boolean): { cls: string; text: string } {
  if (ep.isDraft) return { cls: 'ab-chip ab-chip-muted', text: '试产稿' };
  if (ep.state === 'audited') return { cls: 'ab-chip ab-chip-green', text: `已审听 · ${ep.qa?.ok ?? 0} 段通过` };
  if (ep.state === 'video-ready') return { cls: 'ab-chip ab-chip-indigo', text: '就绪' };
  if (ep.state === 'audio-ready') return { cls: 'ab-chip ab-chip-indigo', text: '就绪（纯音频）' };
  return { cls: 'ab-chip ab-chip-amber', text: '制作中/未完成' };
}

export function BookAudiobook() {
  const { id: bookId = '' } = useParams();
  const [st, setSt] = useState<BookStatus | null>(null);
  const [err, setErr] = useState('');
  const [job, setJob] = useState<AbJobInfo | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advChapters, setAdvChapters] = useState('');
  const [advClean, setAdvClean] = useState(false);
  const [listenFix, setListenFix] = useState(false);
  const [listenSrt, setListenSrt] = useState(false);

  const load = useCallback(async () => {
    try {
      setSt(await api<BookStatus>(`/audiobook/books/${bookId}`));
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [bookId]);

  useEffect(() => { void load(); }, [load]);

  const startJob = async (payload: Record<string, unknown>) => {
    setErr('');
    try {
      const r = await apiPost<AbJobInfo>('/audiobook/jobs', payload);
      setJob(r);
      setShowAdvanced(false);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  /** 建线 + 直接制作第 1 集（冷启动唯一路径，一键闭环） */
  const setupAndBuild = async () => {
    setSettingUp(true);
    setErr('');
    try {
      const s = st?.suggestion;
      await apiPost(`/audiobook/books/${bookId}/setup`, s ? { engine: s.engine, chaptersPerEpisode: s.chaptersPerEpisode, skipVideo: s.skipVideo } : {});
      const r = await apiPost<AbJobInfo>('/audiobook/jobs', { action: 'build', bookId });
      setJob(r);
      void load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSettingUp(false);
    }
  };

  if (err && !st) return <div className="ab-page"><div className="ab-error">{err}</div></div>;
  if (!st) return <div className="ab-page"><div className="ab-empty">加载中…</div></div>;

  // ── 冷启动：建线卡 ──
  if (!st.registered) {
    const s = st.suggestion!;
    return (
      <div className="ab-page">
        <BookTabs active="audiobook" />
        <div className="ab-setup-card">
          <span className="msr ab-setup-icon">graphic_eq</span>
          <h2>把《{st.title}》做成有声书</h2>
          <p className="ab-setup-sub">
            将按默认配置开启：{ENGINE_LABEL[s.engine] ?? s.engine} · 每 {s.chaptersPerEpisode} 章一集 · 纯音频（无场景图时不上视频）
          </p>
          <button className="ab-btn ab-btn-primary ab-setup-cta" disabled={settingUp} onClick={() => void setupAndBuild()}>
            {settingUp ? '正在开启…' : '开启有声书并制作第 1 集'}
          </button>
          <p className="ab-setup-hint">开启即开始制作第 1–{s.chaptersPerEpisode} 章；随时可在集墙上重制或调整</p>
          {err && <div className="ab-error">{err}</div>}
          {job && <JobConsole job={job} onDone={() => void load()} onClose={() => setJob(null)} />}
        </div>
      </div>
    );
  }

  // ── 已建线：工作台 ──
  const presets = st.presets!;
  const next = st.next!;
  const episodes = st.episodes ?? [];
  return (
    <div className="ab-page">
      <BookTabs active="audiobook" />

      <header className="ab-hero">
        <div>
          <h1 className="ab-hero-title">《{st.title}》· 有声书</h1>
          <p className="ab-hero-sub">
            {episodes.length} 集 · {ENGINE_LABEL[presets.engine] ?? presets.engine} · 每 {presets.chaptersPerEpisode} 章一集 · {presets.skipVideo ? '纯音频' : '含视频'}
          </p>
        </div>
        <button className="ab-btn" onClick={() => void startJob({ action: 'listen', bookId, ...(listenFix ? { fix: true } : {}), ...(listenSrt ? { srt: true } : {}) })} title="whisper 逐段回验全部集">
          <span className="msr msr-sm">hearing</span> 审听全部
        </button>
      </header>

      {/* 📺 播放列表与分发物料套件 (Publishing Kit) */}
      {st.playlistMaterial && (
        <div className="pub-kit-card">
          <div className="pub-kit-head">
            <div className="pub-kit-title-group">
              <span className="msr" style={{ color: '#ef4444', fontSize: 26 }}>video_library</span>
              <div>
                <h2 className="pub-kit-title">播放列表与平台发布物料 (Publishing Kit)</h2>
                <span className="pub-field-hint">上传视频前，先在 YouTube Studio 创建播放列表，一键复制以下专属标题与说明</span>
              </div>
            </div>
            <div className="pub-platform-tabs">
              <button type="button" className="pub-platform-tab active">
                <span className="msr msr-sm">smart_display</span> YouTube 油管
              </button>
              <button type="button" className="pub-platform-tab" disabled title="即将上线">
                <span>哔哩哔哩</span>
                <span className="pub-badge-planned">规划中</span>
              </button>
              <button type="button" className="pub-platform-tab" disabled title="即将上线">
                <span>抖音中视频</span>
                <span className="pub-badge-planned">规划中</span>
              </button>
            </div>
          </div>

          {/* 播放列表标题 */}
          <div className="pub-field-card">
            <div className="pub-field-head">
              <div className="pub-field-title">
                <span className="msr msr-sm">title</span> 播放列表标题 (Playlist Title)
              </div>
              <CopyButton text={st.playlistMaterial.title} label="复制标题" />
            </div>
            <input className="input" readOnly value={st.playlistMaterial.title} />
          </div>

          {/* 播放列表说明 */}
          <div className="pub-field-card">
            <div className="pub-field-head">
              <div className="pub-field-title">
                <span className="msr msr-sm">description</span> 播放列表说明 (Playlist Description)
              </div>
              <CopyButton text={st.playlistMaterial.description} label="复制说明" />
            </div>
            <textarea
              className="input"
              readOnly
              rows={6}
              value={st.playlistMaterial.description}
              style={{ fontFamily: 'inherit', lineHeight: 1.6 }}
            />
          </div>

          {/* 播放列表标签 */}
          <div className="pub-field-card" style={{ marginBottom: 0 }}>
            <div className="pub-field-head">
              <div className="pub-field-title">
                <span className="msr msr-sm">tag</span> 建议标签 (Tags)
              </div>
              <CopyButton text={st.playlistMaterial.tagsString} label="复制全部标签 (粘贴进 Studio 标签框)" />
            </div>
            <div className="ab-tags">
              {st.playlistMaterial.tags.map((t) => (
                <span key={t} className="ab-chip ab-chip-muted">#{t}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="ab-listen-bar">
        <span className="ab-listen-label">审听选项：</span>
        <label className="ab-check"><input type="checkbox" checked={listenFix} onChange={(e) => setListenFix(e.target.checked)} />fix（删坏段缓存促重合成）</label>
        <label className="ab-check"><input type="checkbox" checked={listenSrt} onChange={(e) => setListenSrt(e.target.checked)} />srt 重对齐</label>
        <span className="ab-hint">默认只报告不动文件</span>
      </div>

      {/* 制作下一集：人话确认条 + 成本行（高级项折叠） */}
      <div className="ab-next-card">
        <div className="ab-next-main">
          <div className="ab-next-title">制作第 {next.ep} 集</div>
          <div className="ab-next-meta">将使用第 {next.chapters[0]}–{next.chapters[1]} 章 · {ENGINE_LABEL[presets.engine] ?? presets.engine} · {presets.skipVideo ? '纯音频' : '含视频'}</div>
          <div className="ab-next-cost"><span className="msr msr-sm">payments</span> {costLine(next.chars, presets.engine)}</div>
        </div>
        <div className="ab-next-actions">
          <button className="ab-btn ab-btn-primary" onClick={() => void startJob({ action: 'build', bookId })}>
            <span className="msr msr-sm">play_circle</span> 开始制作
          </button>
          <button className="ab-btn" onClick={() => setShowAdvanced((v) => !v)}>
            <span className="msr msr-sm">tune</span> 改范围
          </button>
        </div>
      </div>
      {showAdvanced && (
        <div className="ab-build-form">
          <div className="ab-build-row">
            <label>章节范围<input className="ab-input ab-input-mini" value={advChapters} onChange={(e) => setAdvChapters(e.target.value)} placeholder={`${next.chapters[0]}-${next.chapters[1]}`} /></label>
            <label className="ab-check"><input type="checkbox" checked={advClean} onChange={(e) => setAdvClean(e.target.checked)} />清缓存强制重制</label>
          </div>
          <div className="ab-build-actions">
            <span className="ab-hint">一般无需改动：范围留空按推断；清缓存用于正文修订后旧音频复读问题</span>
            <button
              className="ab-btn ab-btn-primary"
              onClick={() => void startJob({
                action: 'build',
                bookId,
                ...(advChapters.trim() ? { chapters: advChapters.trim() } : {}),
                ...(advClean ? { clean: true } : {}),
              })}
            >
              按此制作
            </button>
          </div>
        </div>
      )}

      {err && <div className="ab-error">{err}</div>}

      {/* 集墙：文件派生状态 */}
      <div className="ab-ep-grid">
        {episodes.map((ep) => {
          const chip = stateChip(ep, presets.skipVideo);
          return (
            <div key={ep.id} className="ab-ep-card">
              <Link to={`/books/${bookId}/audiobook/ep/${ep.ep}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                <div className="ab-ep-thumb">
                  {ep.thumbnailUrl
                    ? <img src={ep.thumbnailUrl} alt={`EP${ep.ep} 缩略图`} loading="lazy" />
                    : <div className="ab-ep-thumb-fallback"><span className="msr">graphic_eq</span></div>}
                  <span className="ab-ep-no">EP{String(ep.ep).padStart(2, '0')}</span>
                  <span className="ab-ep-dur"><span className="msr msr-sm">schedule</span>{fmtDur(ep.durationMs)}</span>
                </div>
                <div className="ab-ep-body">
                  <div className="ab-ep-title">{ep.title.replace(/^【有声书】.*?EP\d+｜/, '') || `第 ${ep.ep} 集`}</div>
                  <div className="ab-ep-meta">
                    {ep.chapters && <span className="ab-chip ab-chip-muted">第 {ep.chapters[0]}–{ep.chapters[1]} 章</span>}
                    <span className={chip.cls}>{chip.text}</span>
                  </div>
                </div>
              </Link>
              <div className="ab-ep-actions">
                <button className="ab-btn" onClick={() => void startJob({ action: 'listen', bookId, ep: String(ep.ep) })}>
                  <span className="msr msr-sm">hearing</span> 审听本集
                </button>
                <button className="ab-btn" onClick={() => void startJob({ action: 'build', bookId, epStart: String(ep.ep), chapters: ep.chapters ? `${ep.chapters[0]}-${ep.chapters[1]}` : undefined })} title="复用段级缓存重跑本章">
                  <span className="msr msr-sm">refresh</span> 重制
                </button>
                <button className="ab-btn" onClick={() => void startJob({ action: 'build', bookId, epStart: String(ep.ep), chapters: ep.chapters ? `${ep.chapters[0]}-${ep.chapters[1]}` : undefined, clean: true })} title="正文/发音修订后使用：清空本章段级缓存重新合成">
                  <span className="msr msr-sm">restart_alt</span> 强制重制
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {job && (
        <JobConsole
          job={job}
          onDone={() => void load()}
          onClose={() => setJob(null)}
        />
      )}
    </div>
  );
}
