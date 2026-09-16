/**
 * 书内·解说 tab（M3）：解说视频工作台——第三衍生形态。
 * 向导式五步流水线（文案→配音→定妆→分镜→成片），状态全部由产物派生；
 * 任务台轮询日志；成品区含播放器、Shorts、发布物料与检查单。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, apiPost, apiPut } from '../api/client.ts';
import { BookTabs } from '../components/BookTabs.tsx';
import { JobConsole, type AbJobInfo } from './BookAudiobook.tsx';

interface Gates {
  passed: boolean;
  structure: { passed: boolean; issues: string[]; totalChars?: number; estimatedMinutes?: number; stats?: Record<string, number> } | null;
  causal: { passed: boolean; violations: { beatId: string; problem: string }[]; triplesChecked?: number } | null;
}
interface NarrStatus {
  registered: boolean;
  title: string;
  presets?: { minutes: number; engine: string };
  suggestion?: { minutes: number; engine: string };
  script: null | {
    sequences: number; beats: number; chars: number; gates: Gates | null;
    characters: { id: string; name: string; status: string; sheetUrl: string | null; promptDesc: string }[];
    approvedAll: boolean;
  };
  audio: null | { url: string; durationMs: number | null; srtUrl: string | null; timed: boolean };
  scenes: { count: number; beats: number };
  video: null | { url: string; durationMs: number | null; shorts: { slot: number; url: string; durationMs: number | null }[]; thumbnailUrl: string | null };
  publish: { title: string; description: string; tags: string[]; tagsString: string; playlist: string; schedule: string; shortsPlan: { slot: number; day: string; title: string }[] };
  checklist: Record<string, boolean>;
  activeJob: { jobId: string; action: string; startedAt: number } | null;
}
interface CostView {
  summary: { entries: number; llmCalls: number; ttsChars: number; images: number; totalCostYuan: number; byStage: { stage: string; entries: number; costYuan: number }[] };
}

const ACTION_LABEL: Record<string, string> = {
  script: '提炼解说文案', audio: '合成多轨配音', sheets: '生成角色定妆照', scenes: '生成分镜图', render: '渲染成片',
};
const CHECKLIST_LABEL: Record<string, string> = {
  'title-copied': '标题已复制', 'description-copied': '简介已复制', 'tags-copied': '标签已复制',
  'thumbnail-ready': '封面已准备', 'srt-uploaded': '字幕已上传', 'ai-disclosure': 'AI 披露已勾选',
  'not-for-kids': '非儿童内容', 'endscreen-playlist': '片尾挂有声书列表', 'pinned-comment': '置顶导流评论',
  scheduled: '已排期（Day3）', 'shorts-linked': 'Shorts 已挂链接',
};

function fmtDur(ms: number | null | undefined): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function BookNarration() {
  const { id: bookId = '' } = useParams();
  const [st, setSt] = useState<NarrStatus | null>(null);
  const [cost, setCost] = useState<CostView | null>(null);
  const [err, setErr] = useState('');
  const [job, setJob] = useState<AbJobInfo | null>(null);
  const [minutes, setMinutes] = useState('15');
  const [wantShorts, setWantShorts] = useState(true);
  const [wantThumb, setWantThumb] = useState(true);
  const [copied, setCopied] = useState('');
  // 采纳在跑任务时用 ref 判重（load 身份只随 bookId 变——评审 P1-2/P1-3）
  const jobRef = useRef<AbJobInfo | null>(null);
  jobRef.current = job;

  const load = useCallback(async () => {
    try {
      const s = await api<NarrStatus>(`/narration/books/${bookId}`);
      setSt(s);
      setErr('');
      if (s.registered) {
        setCost(await api<CostView>(`/narration/books/${bookId}/cost`));
        if (s.activeJob && !jobRef.current) setJob({ jobId: s.activeJob.jobId, args: [] });
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [bookId]);

  useEffect(() => { void load(); }, [load]);

  // 切书复位任务台（上一本书的在跑任务不压这一本的按钮）
  useEffect(() => { setJob(null); }, [bookId]);

  const setup = async () => {
    try {
      await apiPost(`/narration/books/${bookId}/setup`, { minutes: Number(minutes) || 15 });
      await load();
    } catch (e) { setErr((e as Error).message); }
  };

  const startAction = async (action: string) => {
    setErr('');
    try {
      const r = await apiPost<AbJobInfo>(`/narration/jobs`, {
        bookId, action,
        ...(action === 'render' ? { shorts: wantShorts, thumb: wantThumb } : {}),
      });
      setJob(r);
    } catch (e) { setErr((e as Error).message); }
  };

  const approveCharacters = async () => {
    try {
      await apiPost(`/narration/books/${bookId}/characters/approve`, {});
      await load();
    } catch (e) { setErr((e as Error).message); }
  };

  const toggleCheck = async (k: string, v: boolean) => {
    try {
      await apiPut(`/narration/books/${bookId}/checklist`, { [k]: v });
      setSt((s) => (s ? { ...s, checklist: { ...s.checklist, [k]: v } } : s));
    } catch (e) { setErr((e as Error).message); }
  };

  const copy = async (label: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(''), 1500); } catch { /* 剪贴板被拒 */ }
  };

  if (err && !st) return <div className="ab-page"><BookTabs active="narration" /><div className="ab-error">{err}</div></div>;
  if (!st) return <div className="ab-page"><BookTabs active="narration" /><div className="ab-empty">加载中…</div></div>;

  // ── 未建线：建线卡（时长即定位：短篇快消化 or 全书深度解说） ──
  // 未注册的 status 只有 registered/bookId/title/suggestion，须在读 scenes/script 等字段之前早退
  if (!st.registered) {
    return (
      <div className="ab-page">
        <BookTabs active="narration" />
        <header className="ab-hero">
          <div>
            <h1 className="ab-hero-title">《{st.title}》· 解说视频</h1>
            <p className="ab-hero-sub">把小说提炼成节奏化的解说文案，配上角色一致的插图与悬疑解说配音——比有声书更快吸粉的形态</p>
          </div>
        </header>
        <div className="ab-next-card">
          <div className="ab-next-main">
            <div className="ab-next-title">开启解说线</div>
            <div className="ab-next-meta">先定目标时长（决定解谜环数与口播字数）；配音引擎按已有凭据自动推荐（{st.suggestion?.engine === 'volcengine' ? '火山引擎 · 悬疑解说音色' : 'Edge · 免费音色'}）</div>
            <div className="ab-config-grid" style={{ marginTop: 10 }}>
              <label>目标时长
                <select className="ab-input" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
                  <option value="8">8 分钟 · 短篇快消化</option>
                  <option value="10">10 分钟 · 短篇</option>
                  <option value="12">12 分钟 · 短中篇</option>
                  <option value="15">15 分钟 · 标准</option>
                  <option value="20">20 分钟 · 中长篇</option>
                  <option value="25">25 分钟 · 长篇深度</option>
                  <option value="30">30 分钟 · 全书解说</option>
                </select>
              </label>
            </div>
          </div>
          <div className="ab-next-actions">
            <button className="ab-btn ab-btn-primary" onClick={() => void setup()}>
              <span className="msr msr-sm">auto_awesome</span> 开启解说线
            </button>
          </div>
        </div>
        {err && <div className="ab-error">{err}</div>}
      </div>
    );
  }

  // 任务台开着（含完成后未关闭）即视为占线：按钮禁用，关掉任务台恢复
  const busy = !!job;
  const busyAction = job ? job.args[1] : '';
  const scriptReady = !!st.script;
  const gates = st.script?.gates ?? null;
  const audioReady = !!st.audio?.timed;
  const sheetsReady = (st.script?.characters.length ?? 0) > 0 && st.script!.characters.every((c) => c.sheetUrl);
  const scenesReady = st.scenes.beats > 0 && st.scenes.count >= st.scenes.beats;

  const step = (n: number, name: string, state: 'done' | 'ready' | 'blocked' | 'running', desc: React.ReactNode, cta: { label: string; run: () => void; action?: string } | null) => (
    <div className={`narr-step narr-step-${state}`}>
      <div className="narr-step-head">
        <span className={`narr-step-dot msr`}>{state === 'done' ? 'check_circle' : state === 'running' ? 'progress_activity' : state === 'blocked' ? 'lock' : 'radio_button_unchecked'}</span>
        <span className="narr-step-no">第 {n} 步</span>
        <span className="narr-step-name">{name}</span>
        <span className={`narr-step-state narr-state-${state}`}>{state === 'done' ? '已完成' : state === 'running' ? '进行中' : state === 'blocked' ? '待前序完成' : '可开始'}</span>
      </div>
      <div className="narr-step-body">{desc}</div>
      {cta && (
        <div className="narr-step-cta">
          <button className="ab-btn ab-btn-primary" disabled={busy || state === 'blocked'} onClick={cta.run}>
            <span className="msr msr-sm">play_arrow</span> {busy && cta.action && busyAction === cta.action ? '进行中…' : cta.label}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="ab-page">
      <BookTabs active="narration" />
      <header className="ab-hero">
        <div>
          <h1 className="ab-hero-title">《{st.title}》· 解说视频</h1>
          <p className="ab-hero-sub">
            目标 {st.presets?.minutes} 分钟 · 五步出片：文案双门 → 配音 → 角色定妆 → 分镜 → 成片
            {cost && cost.summary.entries > 0 && ` · 已投入约 ¥${cost.summary.totalCostYuan}（文案 ${cost.summary.llmCalls} 次 / 配音 ${(cost.summary.ttsChars / 10000).toFixed(1)} 万字 / 生图 ${cost.summary.images} 张）`}
          </p>
        </div>
      </header>

      {/* 任务台（复用有声书 JobConsole：SSE 日志流 + 取消；终态事件驱动刷新） */}
      {job && (
        <div className="narr-console-wrap">
          {busyAction && <div className="narr-console-label">{ACTION_LABEL[busyAction] ?? busyAction}</div>}
          <JobConsole job={job} basePath="/api/narration" onDone={() => void load()} onClose={() => setJob(null)} />
        </div>
      )}

      {err && <div className="ab-error">{err}</div>}

      <div className="narr-steps">
        {step(1, '解说文案', busy && busyAction === 'script' ? 'running' : scriptReady ? (gates?.passed ? 'done' : 'ready') : 'ready',
          scriptReady ? (
            <>
              <div className="narr-metrics">
                <span className="ab-chip">{st.script!.sequences} 个解谜环 · {st.script!.beats} 拍 · {st.script!.chars} 字</span>
                {gates && (
                  <span className={`ab-chip ${gates.passed ? 'ab-chip-green' : 'ab-chip-red'}`}>
                    结构门 {gates.structure?.passed ? '✓' : '✗'} · 因果门 {gates.causal?.passed ? '✓' : '✗'}
                  </span>
                )}
              </div>
              {gates && !gates.passed && (
                <ul className="narr-issues">
                  {[...(gates.structure?.issues ?? []), ...(gates.causal?.violations ?? []).map((v) => `[${v.beatId}] ${v.problem}`)].slice(0, 5).map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              )}
              <div className="narr-hint">改稿后重跑会按章失效缓存；也可以改完后只重跑本步复检双门</div>
            </>
          ) : (
            <div className="narr-hint">四阶段提炼：全书物证图谱 → 逐章带锁摘要 → 解谜环规划 → 逐拍文案（自带结构与因果两道门禁）</div>
          ),
          { label: scriptReady ? '重新提炼' : '开始提炼', run: () => void startAction('script'), action: 'script' })}

        {step(2, '配音', busy && busyAction === 'audio' ? 'running' : audioReady ? 'done' : scriptReady ? (gates?.passed ? 'ready' : 'blocked') : 'blocked',
          audioReady ? (
            <div className="narr-metrics">
              <span className="ab-chip">音轨 {fmtDur(st.audio!.durationMs)} · 句级字幕就绪</span>
              <span className="ab-chip ab-chip-muted">解说 + 引语双轨（引语带录音机质感）</span>
            </div>
          ) : <div className="narr-hint">悬疑解说音色多轨合成；时长按句实测回填，供分镜与字幕对齐{!gates?.passed && '（双门全绿后解锁）'}</div>,
          scriptReady && gates?.passed ? { label: '合成配音', run: () => void startAction('audio'), action: 'audio' } : null)}

        {step(3, '角色定妆', busy && busyAction === 'sheets' ? 'running' : sheetsReady ? (st.script!.approvedAll ? 'done' : 'ready') : scriptReady ? 'ready' : 'blocked',
          <div className="narr-sheets">
            <div className="narr-chars">
              {st.script?.characters.map((c) => (
                <div key={c.id} className={`narr-char ${c.status === 'approved' ? 'narr-char-ok' : ''}`} title={c.promptDesc}>
                  {c.sheetUrl
                    ? <img src={c.sheetUrl} alt={c.name} loading="lazy" />
                    : <div className="narr-char-blank"><span className="msr">person</span></div>}
                  <span className="narr-char-name">{c.name}</span>
                  {c.status === 'approved' && <span className="msr msr-sm narr-char-badge">verified</span>}
                </div>
              ))}
            </div>
            {sheetsReady && !st.script!.approvedAll && (
              <button className="ab-btn" disabled={busy} onClick={() => void approveCharacters()}>
                <span className="msr msr-sm">verified</span> 审看无误，全部批准
              </button>
            )}
            <div className="narr-hint">定妆照是全片角色一致性的锚——批准后分镜图才会引用它们生成（未批准会被拦）</div>
          </div>,
          scriptReady ? { label: sheetsReady ? '重新生成定妆照' : '生成定妆照', run: () => void startAction('sheets'), action: 'sheets' } : null)}

        {step(4, '分镜图', busy && busyAction === 'scenes' ? 'running' : scenesReady ? 'done' : st.script?.approvedAll ? 'ready' : 'blocked',
          scenesReady ? (
            <div className="narr-metrics">
              <span className="ab-chip">{st.scenes.count}/{st.scenes.beats} 拍全部成图</span>
              <span className="ab-chip ab-chip-muted">每拍以定妆照为参考图生成，保持角色一致</span>
            </div>
          ) : <div className="narr-hint">以批准的定妆照作参考图逐拍生图（物证/环境/背影优先，防人脸漂移）{!st.script?.approvedAll && '（先在第 3 步批准定妆照）'}</div>,
          st.script?.approvedAll ? { label: scenesReady ? '补齐/重生成' : '生成分镜图', run: () => void startAction('scenes'), action: 'scenes' } : null)}

        {step(5, '成片', busy && busyAction === 'render' ? 'running' : st.video ? 'done' : scenesReady && audioReady ? 'ready' : 'blocked',
          <div className="narr-render-opts">
            <div className="narr-metrics">
              {st.video
                ? <><span className="ab-chip">正片 {fmtDur(st.video.durationMs)}</span>{st.video.shorts.length > 0 && <span className="ab-chip">{st.video.shorts.length} 条竖版切片</span>}{st.video.thumbnailUrl && <span className="ab-chip">封面已生成</span>}</>
                : <span className="ab-chip ab-chip-muted">字幕烧录 · 疑点进度锚 · 拍点音效 · 慢推镜</span>}
            </div>
            {!st.video && (
              <div className="narr-checks">
                <label><input type="checkbox" checked={wantShorts} onChange={(e) => setWantShorts(e.target.checked)} /> 同时切 3 条竖版 Shorts</label>
                <label><input type="checkbox" checked={wantThumb} onChange={(e) => setWantThumb(e.target.checked)} /> 同时生成封面</label>
              </div>
            )}
          </div>,
          scenesReady && audioReady ? { label: st.video ? '重新渲染' : '渲染成片', run: () => void startAction('render'), action: 'render' } : null)}
      </div>

      {/* 成品 + 发布物料 */}
      {st.video && (
        <section className="narr-deliver">
          <h2 className="narr-sec-title">成品与发布</h2>
          <div className="narr-deliver-grid">
            <div className="narr-player">
              <video controls preload="metadata" src={st.video.url} poster={st.video.thumbnailUrl ?? undefined} />
              <div className="narr-player-bar">
                <a className="ab-btn" href={st.video.url} target="_blank" rel="noreferrer"><span className="msr msr-sm">open_in_new</span> 正片</a>
                {st.audio?.srtUrl && <a className="ab-btn" href={st.audio.srtUrl} target="_blank" rel="noreferrer"><span className="msr msr-sm">subtitles</span> 字幕</a>}
                {st.video.thumbnailUrl && <a className="ab-btn" href={st.video.thumbnailUrl} target="_blank" rel="noreferrer"><span className="msr msr-sm">image</span> 封面</a>}
              </div>
            </div>
            <div className="narr-publish">
              <div className="narr-publish-row">
                <strong>{st.publish.title}</strong>
                <button className="ab-btn" onClick={() => void copy('title', st.publish.title)}>{copied === 'title' ? '已复制' : '复制'}</button>
              </div>
              <div className="narr-publish-row narr-publish-desc">
                <pre>{st.publish.description}</pre>
                <button className="ab-btn" onClick={() => void copy('desc', st.publish.description)}>{copied === 'desc' ? '已复制' : '复制'}</button>
              </div>
              <div className="narr-publish-row">
                <span className="ab-chip ab-chip-muted">{st.publish.tagsString}</span>
                <button className="ab-btn" onClick={() => void copy('tags', st.publish.tagsString)}>{copied === 'tags' ? '已复制' : '复制'}</button>
              </div>
              <div className="narr-hint">策略：{st.publish.schedule}</div>
              {st.video.shorts.length > 0 && (
                <div className="narr-shorts">
                  {st.video.shorts.map((s) => {
                    const plan = st.publish.shortsPlan.find((p) => p.slot === s.slot);
                    return (
                      <a key={s.slot} className="narr-short-card" href={s.url} target="_blank" rel="noreferrer">
                        <video preload="metadata" src={s.url} muted />
                        <span className="narr-short-label">{plan ? `${plan.day} · ${plan.title}` : `切片 ${s.slot}`}</span>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="narr-checklist">
            <h3>发布检查单</h3>
            {Object.entries(st.checklist).map(([k, v]) => (
              <label key={k} className="narr-check-item">
                <input type="checkbox" checked={v} onChange={(e) => void toggleCheck(k, e.target.checked)} /> {CHECKLIST_LABEL[k] ?? k}
              </label>
            ))}
          </div>

          {cost && cost.summary.entries > 0 && (
            <div className="narr-cost">
              <h3>成本台账</h3>
              <span className="ab-chip">合计 ≈¥{cost.summary.totalCostYuan}</span>
              {cost.summary.byStage.map((s) => (
                <span key={s.stage} className="ab-chip ab-chip-muted">{ACTION_LABEL[s.stage] ?? s.stage} ×{s.entries} · ¥{s.costYuan}</span>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
