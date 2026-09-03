/**
 * 集详情 — 播放器（内嵌 VTT 字幕）+ 场景图画廊（灯箱）+ 逐段台本 +
 * 审听报告（CER 打点可跳转）+ 上传物料。
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiPost } from '../api/client.ts';
import { fmtDur } from './BookAudiobook.tsx';
import { BookTabs } from '../components/BookTabs.tsx';
import { CopyButton } from '../components/CopyButton.tsx';

interface Segment { id: string; kind: string; speaker?: string; text: string; voice: string }
interface AbDetail {
  ep: number; id: string; title: string; durationMs: number | null;
  videoUrl: string | null; audioUrl: string | null; srtUrl: string | null;
  uploadJsonUrl: string | null;
  thumbnailUrl: string | null;
  chapters: { pos: number; title: string; segments: number; attributed: number }[];
  chapterStartsMs: { pos: number; startMs: number }[];
  images: { chapter: number; url: string; name: string; desc?: string }[];
  scripts: { pos: number; title: string; segments: Segment[] }[];
  listen: {
    counts: { ok: number; suspect: number; bad: number; missing: number; silent: number };
    worst: { id: string; verdict: string; cer: number; ref: string; hyp: string; startMs: number }[];
  };
  upload: {
    platform?: string;
    title?: string;
    description?: string;
    tags?: string[];
    tagsString?: string;
    playlist?: string;
    thumbnailUrl?: string | null;
    srtUrl?: string | null;
    videoUrl?: string | null;
    audioUrl?: string | null;
    settingsChecklist?: {
      madeForKids: boolean;
      alteredContent: boolean;
      language: string;
      category: string;
      categoryName: string;
    };
  } | null;
}

const KIND_LABEL: Record<string, string> = { narration: '旁白', dialogue: '对白', letter: '信' };
const VERDICT_CLS: Record<string, string> = { bad: 'ab-chip ab-chip-red', suspect: 'ab-chip ab-chip-amber', missing: 'ab-chip ab-chip-red', silent: 'ab-chip ab-chip-red' };

export function AudiobookEpisode() {
  const { id: bookId = '', ep = '' } = useParams();
  const [d, setD] = useState<AbDetail | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'gallery' | 'script' | 'listen' | 'upload'>('gallery');
  const [chPos, setChPos] = useState<number | null>(null);
  const [vttUrl, setVttUrl] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [regenJob, setRegenJob] = useState<{ jobId: string; count: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const load = useCallback(async () => {
    try {
      const x = await api<AbDetail>(`/audiobook/books/${bookId}/ep/${Number(ep)}`);
      setD(x);
      setChPos(x.scripts[0]?.pos ?? null);
    } catch (e) { setErr(String(e)); }
  }, [bookId, ep]);

  useEffect(() => { void load(); }, [load]);

  /** 重跑单张场景图：删旧 + Seedream 重新生成（约 80s）→ 刷新图库 */
  const regenImage = async (imageId: string) => {
    try {
      setRegenJob({ jobId: '', count: 1 });
      const r = await apiPost<{ jobId: string; deleted: number }>(`/audiobook/books/${bookId}/scenes/regenerate`, { images: [imageId] });
      setRegenJob({ jobId: r.jobId, count: 1 });
      // 轮询 job 完成（简化：不接 SSE，30s 间隔查一次）
      const poll = setInterval(async () => {
        try {
          const j = await fetch(`/api/audiobook/jobs/${r.jobId}?_=${Date.now()}`);
          const job = await j.json();
          if (job.status !== 'running') {
            clearInterval(poll);
            setRegenJob(null);
            void load();
          }
        } catch { /* 继续轮询 */ }
      }, 10_000);
    } catch (e) {
      setErr((e as Error).message);
      setRegenJob(null);
    }
  };

  // srt → vtt（浏览器内转换，播放器 <track> 直接吃 blob URL）
  useEffect(() => {
    setVttUrl(null);
    if (!d?.srtUrl) return;
    void fetch(d.srtUrl).then((r) => r.text()).then((srt) => {
      const vtt = 'WEBVTT\n\n' + srt.replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').trim();
      setVttUrl(URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' })));
    }).catch(() => undefined);
  }, [d?.srtUrl]);

  const seek = (ms: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    v.play().catch(() => undefined);
  };
  const chStart = (pos: number) => d?.chapterStartsMs.find((c) => c.pos === pos)?.startMs ?? 0;

  const worstWithJump = useMemo(() => (d?.listen.worst ?? []).map((w) => {
    const chNum = Number((w.id.match(/^ch(\d+)/) ?? [0, 0])[1]);
    const cs = d?.chapterStartsMs.find((c) => c.pos === chNum)?.startMs ?? 0;
    return { ...w, jumpMs: cs + w.startMs };
  }), [d]);

  const grouped = useMemo(() => {
    const g = new Map<number, NonNullable<typeof d>['images']>();
    for (const img of d?.images ?? []) {
      const list = g.get(img.chapter) ?? [];
      list.push(img);
      g.set(img.chapter, list);
    }
    return [...g.entries()].sort((a, b) => a[0] - b[0]);
  }, [d]);

  if (err) return <div className="ab-page"><div className="ab-error">{err}</div></div>;
  if (!d) return <div className="ab-page"><div className="ab-empty">加载中…</div></div>;

  const counts = d.listen.counts;
  const total = counts.ok + counts.suspect + counts.bad + counts.missing + counts.silent || 1;
  const cur = d.scripts.find((s) => s.pos === chPos) ?? d.scripts[0];

  return (
    <div className="ab-page">
      <BookTabs active="audiobook" />
      <div className="ab-ep-nav">
        <Link to={`/books/${bookId}/audiobook`} className="ab-back">← 有声书集墙</Link>
        <span className="ab-ep-crumb">EP{String(d.ep).padStart(2, '0')}</span>
      </div>

      <div className="ab-detail-grid">
        <div className="ab-player-col">
          {d.videoUrl ? (
            <video
              ref={videoRef}
              className="ab-player"
              controls
              preload="metadata"
              poster={d.thumbnailUrl ?? undefined}
              src={d.videoUrl}
              crossOrigin="anonymous"
            >
              {vttUrl && <track kind="subtitles" srcLang="zh" label="中文" src={vttUrl} default />}
            </video>
          ) : d.audioUrl ? (
            <div className="ab-player ab-player-audio">
              <div className="ab-player-audio-hint">本集暂无视频，音频模式</div>
              <audio ref={videoRef as unknown as React.RefObject<HTMLAudioElement>} controls src={d.audioUrl} style={{ width: '100%' }} />
            </div>
          ) : (
            <div className="ab-player ab-player-audio"><div className="ab-player-audio-hint">本集没有媒体文件</div></div>
          )}

          <h2 className="ab-ep-h2">{d.title.replace(/^【有声书】.*?EP\d+｜/, '')}</h2>
          <div className="ab-ep-meta">
            <span className="ab-chip ab-chip-muted">时长 {fmtDur(d.durationMs)}</span>
            {d.chapters.map((c) => (
              <button key={c.pos} className="ab-chip ab-chip-link" onClick={() => seek(chStart(c.pos))} title={`跳到第${c.pos}章`}>
                第{c.pos}章 {c.title}
              </button>
            ))}
          </div>
        </div>

        <div className="ab-panel-col">
          <div className="ab-tabs">
            {([['gallery', `场景图库 ${d.images.length}`], ['script', '台本'], ['listen', '审听报告'], ['upload', '上传物料']] as const).map(([k, label]) => (
              <button key={k} className={`ab-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          {tab === 'gallery' && (
            <div className="ab-tab-body">
              {grouped.length === 0 && <div className="ab-empty">本集没有场景图（scenes/ 目录为空）</div>}
              {regenJob && (
                <div className="ab-regen-banner">
                  <span className="ab-pulse-dot" /> 场景图重跑中…（{regenJob.count} 张）
                  <button className="ab-btn" onClick={() => setRegenJob(null)}>完成</button>
                </div>
              )}
              {grouped.map(([chp, imgs]) => (
                <div key={chp} className="ab-gallery-group">
                  <div className="ab-gallery-head">第 {chp} 章 · {imgs.length} 张</div>
                  <div className="ab-gallery-grid">
                    {imgs.map((img, i) => {
                      const globalIdx = d.images.findIndex((x) => x.url === img.url);
                      const imgId = img.name.replace(/\.jpe?g$/i, '');
                      return (
                        <div key={img.url} className="ab-gallery-item-wrap">
                          <button className="ab-gallery-item" onClick={() => setLightbox(globalIdx)} title={img.desc ?? img.name}>
                            <img src={img.url} alt={img.name} loading="lazy" />
                            <span className="ab-gallery-tag">{imgId}{i === 0 ? ' · 首发' : ''}</span>
                          </button>
                          <button
                            className="ab-gallery-regen"
                            title="重跑此图（删旧图 + Seedream 重新生成）"
                            onClick={() => void regenImage(imgId)}
                            disabled={!!regenJob}
                          >
                            <span className="msr msr-sm">restart_alt</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'script' && cur && (
            <div className="ab-tab-body">
              <div className="ab-script-pills">
                {d.scripts.map((s) => (
                  <button key={s.pos} className={`ab-chip ab-chip-link ${s.pos === chPos ? 'ab-chip-active' : ''}`} onClick={() => setChPos(s.pos)}>
                    第{s.pos}章（{s.segments.length} 段）
                  </button>
                ))}
                <button className="ab-chip ab-chip-link" onClick={() => seek(chStart(cur.pos))}>▶ 从本章开头播放</button>
              </div>
              <div className="ab-script-list">
                {cur.segments.map((s) => (
                  <div key={s.id} className={`ab-seg ab-seg-${s.kind}`}>
                    <div className="ab-seg-head">
                      <span className={`ab-chip ab-chip-${s.kind === 'dialogue' ? 'indigo' : s.kind === 'letter' ? 'amber' : 'muted'}`}>
                        {KIND_LABEL[s.kind] ?? s.kind}
                      </span>
                      {s.speaker && <span className="ab-seg-speaker">{s.speaker}</span>}
                      <span className="ab-seg-voice">{s.voice.replace(/^zh-CN-/, '').replace('Neural', '')}</span>
                    </div>
                    <div className="ab-seg-text">{s.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'listen' && (
            <div className="ab-tab-body">
              {counts.ok + counts.suspect + counts.bad + counts.missing + counts.silent === 0 ? (
                <div className="ab-empty">本集还没有审听报告。回工作台点「审听本版本」生成。</div>
              ) : (
                <>
                  <div className="ab-qa-bars">
                    {([['ok', '正常', 'var(--green)'], ['suspect', '存疑', 'var(--amber)'], ['bad', '坏段', 'var(--red)'], ['missing', '缺失', 'var(--red)'], ['silent', '静音', 'var(--red)']] as const).map(([k, label, color]) => (
                      <div key={k} className="ab-qa-bar">
                        <span className="ab-qa-label">{label} {counts[k]}</span>
                        <div className="ab-qa-track"><div className="ab-qa-fill" style={{ width: `${(counts[k] / total) * 100}%`, background: color }} /></div>
                      </div>
                    ))}
                  </div>
                  <div className="ab-hint">报告是给人耳排优先级的雷达：suspect/bad 多为 whisper 近音听岔（如「皱眉→咒梅」），点时间戳跳到对应位置人工复听。</div>
                  <div className="ab-worst-list">
                    {worstWithJump.map((w) => (
                      <button key={w.id} className="ab-worst-item" onClick={() => seek(w.jumpMs)}>
                        <span className={VERDICT_CLS[w.verdict] ?? 'ab-chip ab-chip-muted'}>{w.verdict}</span>
                        <span className="ab-worst-cer">CER {w.cer.toFixed(2)}</span>
                        <span className="ab-worst-time">{Math.floor(w.jumpMs / 60000)}:{String(Math.floor((w.jumpMs % 60000) / 1000)).padStart(2, '0')}</span>
                        <span className="ab-worst-text">
                          「{w.ref.slice(0, 26)}」⇢ ASR「{w.hyp.replace(/\s/g, '').slice(0, 26)}」
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'upload' && (
            <div className="ab-tab-body">
              {/* 平台切换栏 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
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
                <span className="pub-field-hint">逐项复制以下内容贴入 YouTube Studio 上传页</span>
              </div>

              {d.upload ? (
                <>
                  {/* 1. 缩略图 / 封面卡片 */}
                  <div className="pub-field-card">
                    <div className="pub-field-head">
                      <div className="pub-field-title">
                        <span className="msr msr-sm">image</span> 视频缩略图 / 封面 (Thumbnail)
                      </div>
                      <span className="pub-field-hint">YouTube 推荐：1280×720 (16:9)，格式 JPG/PNG，小于 2MB</span>
                    </div>
                    <div className="pub-thumb-section">
                      <div className="pub-thumb-box">
                        {d.thumbnailUrl ? (
                          <img src={d.thumbnailUrl} alt="视频缩略图" />
                        ) : d.images[0]?.url ? (
                          <img src={d.images[0].url} alt="场景缩略图" />
                        ) : (
                          <span className="msr" style={{ fontSize: 40, opacity: 0.4 }}>movie</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                          高点击率的封面是 YouTube 算法分发的生命线。建议采用 16:9 宽屏无水印画面，并保持全剧排版风格一致。
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          {(d.thumbnailUrl || d.images[0]?.url) && (
                            <a
                              className="pub-copy-btn"
                              href={d.thumbnailUrl || d.images[0]?.url}
                              download={`EP${String(d.ep).padStart(2, '0')}-cover.jpg`}
                            >
                              <span className="msr msr-sm">download</span> 下载封面图片 (JPG)
                            </a>
                          )}
                          {(d.thumbnailUrl || d.images[0]?.url) && (
                            <a
                              className="pub-copy-btn"
                              href={d.thumbnailUrl || d.images[0]?.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <span className="msr msr-sm">open_in_new</span> 新窗口查看原图
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 2. 视频标题 */}
                  <div className="pub-field-card">
                    <div className="pub-field-head">
                      <div className="pub-field-title">
                        <span className="msr msr-sm">title</span> 视频标题 (Title)
                      </div>
                      <CopyButton text={d.upload.title ?? ''} label="复制标题" />
                    </div>
                    <input className="input" readOnly value={d.upload.title ?? ''} />
                  </div>

                  {/* 3. 归属播放列表 */}
                  {d.upload.playlist && (
                    <div className="pub-field-card">
                      <div className="pub-field-head">
                        <div className="pub-field-title">
                          <span className="msr msr-sm">playlist_add_check</span> 加入播放列表 (Playlist)
                        </div>
                        <CopyButton text={d.upload.playlist} label="复制列表名称" />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input className="input" readOnly value={d.upload.playlist} />
                      </div>
                      <span className="pub-field-hint">请在上传表单的「播放列表」下拉菜单中勾选此项，便于观众连贯收听全集。</span>
                    </div>
                  )}

                  {/* 4. 视频描述（含章节时间轴） */}
                  <div className="pub-field-card">
                    <div className="pub-field-head">
                      <div className="pub-field-title">
                        <span className="msr msr-sm">description</span> 视频说明与章节导航 (Description & Chapters)
                      </div>
                      <CopyButton text={d.upload.description ?? ''} label="复制完整描述" />
                    </div>
                    <textarea
                      className="input"
                      readOnly
                      rows={8}
                      value={d.upload.description ?? ''}
                      style={{ fontFamily: 'inherit', lineHeight: 1.6 }}
                    />
                    <span className="pub-field-hint">首行已包含 0:00 章节标记，YouTube 将自动识别并在视频进度条上生成分段标记。</span>
                  </div>

                  {/* 5. 视频标签 */}
                  <div className="pub-field-card">
                    <div className="pub-field-head">
                      <div className="pub-field-title">
                        <span className="msr msr-sm">tag</span> 视频标签 (Tags)
                      </div>
                      <CopyButton
                        text={d.upload.tagsString || (d.upload.tags ?? []).join(', ')}
                        label="复制标签文本 (可直接粘贴进 Studio)"
                      />
                    </div>
                    <div className="ab-tags">
                      {(d.upload.tags ?? []).map((t) => (
                        <span key={t} className="ab-chip ab-chip-muted">#{t}</span>
                      ))}
                    </div>
                  </div>

                  {/* 6. YouTube Studio 关键表单选项速查 */}
                  <div className="pub-field-card">
                    <div className="pub-field-head">
                      <div className="pub-field-title">
                        <span className="msr msr-sm">checklist</span> YouTube 后台设置速查清单 (Settings Cheat-Sheet)
                      </div>
                    </div>
                    <div className="pub-checklist-grid">
                      <div className="pub-checklist-item">
                        <span className="pub-checklist-key">面向儿童 (Made for kids)</span>
                        <span className="pub-checklist-val" style={{ color: 'var(--amber, #f59e0b)' }}>
                          <span className="msr msr-sm">block</span> 否，这不是专为儿童制作的
                        </span>
                      </div>
                      <div className="pub-checklist-item">
                        <span className="pub-checklist-key">合成或修改过的内容 (Altered Content)</span>
                        <span className="pub-checklist-val" style={{ color: 'var(--green, #10b981)' }}>
                          <span className="msr msr-sm">check_circle</span> 是，包含 AI 生成语音
                        </span>
                      </div>
                      <div className="pub-checklist-item">
                        <span className="pub-checklist-key">视频语言 (Video Language)</span>
                        <span className="pub-checklist-val">中文（简体）</span>
                      </div>
                      <div className="pub-checklist-item">
                        <span className="pub-checklist-key">类别推荐 (Category)</span>
                        <span className="pub-checklist-val">娱乐 (Entertainment)</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="ab-empty">暂无物料信息。</div>
              )}

              {/* 7. 字幕与音视频素材快速下载 */}
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: '#f59e0b' }}>
                  <span className="msr msr-sm">info</span> 字幕说明：YouTube 会忽略 MP4 内置字幕轨，请在后台「字幕」栏单独上传 SRT 文件并选择「中文（简体）」
                </div>
                <div className="ab-upload-downloads" style={{ marginTop: 8, paddingTop: 10 }}>
                  <a className="ab-btn" href={d.srtUrl ?? '#'} download><span className="msr msr-sm">closed_caption</span> 下载 SRT 字幕</a>
                  <a className="ab-btn" href={d.videoUrl ?? '#'} download><span className="msr msr-sm">movie</span> 下载成片 MP4</a>
                  <a className="ab-btn" href={d.audioUrl ?? '#'} download><span className="msr msr-sm">graphic_eq</span> 下载 MP3 音频</a>
                  {d.uploadJsonUrl && <a className="ab-btn" href={d.uploadJsonUrl} download><span className="msr msr-sm">download</span> youtube-upload.json</a>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {lightbox !== null && d.images[lightbox] && (
        <div className="ab-lightbox" onClick={() => setLightbox(null)}>
          <button className="ab-lb-nav" onClick={(e) => { e.stopPropagation(); setLightbox((lightbox - 1 + d.images.length) % d.images.length); }}><span className="msr">chevron_left</span></button>
          <img src={d.images[lightbox].url} alt={d.images[lightbox].name} onClick={(e) => e.stopPropagation()} />
          <div className="ab-lb-cap">
            <span className="ab-lb-count">{lightbox + 1} / {d.images.length}</span>
            <span className="ab-lb-div" />
            <span>第{d.images[lightbox].chapter}章</span>
            <span className="ab-lb-div" />
            <span className="ab-lb-name">{d.images[lightbox].name}</span>
          </div>
          <button className="ab-lb-nav" onClick={(e) => { e.stopPropagation(); setLightbox((lightbox + 1) % d.images.length); }}><span className="msr">chevron_right</span></button>
          <button className="ab-lb-close" onClick={() => setLightbox(null)}><span className="msr">close</span></button>
        </div>
      )}
    </div>
  );
}
