/**
 * 书级配置中心（M1）：制作预设（registry.presets）+ 内容工程（projects/<书名>.json）。
 * 分工铁律（PLAN §3）：两区数据生命周期不同，分开保存、互不越界；
 * UI 上不暴露文件路径概念，只呈现「制作预设」「发音与班底」两个人话分区。
 */
import React, { useEffect, useState } from 'react';
import { api, apiPut } from '../api/client.ts';

interface VoiceOption { voice: string; label: string }

interface VoiceRuleRow { match: string; voice: string; rate?: string; pitch?: string }
interface PronRow { match: string; read: string; note?: string }

interface BookConfig {
  presets: { engine: string; chaptersPerEpisode: number; skipVideo: boolean } | null;
  project: {
    pron?: PronRow[];
    voiceBySpeaker?: VoiceRuleRow[];
    cast?: string[];
    sceneStyle?: string;
    sceneCharacters?: string;
    narrator?: string;
    defaultSpeaker?: string;
  };
  source: string | null;
  voices: VoiceOption[];
}

const ENGINE_LABEL: Record<string, string> = { edge: 'Edge（免费）', volcengine: '豆包班底（火山）', minimax: 'MiniMax' };

export function BookAudiobookConfig({ bookId, onClose, onSaved }: { bookId: string; onClose: () => void; onSaved: () => void }) {
  const [cfg, setCfg] = useState<BookConfig | null>(null);
  const [err, setErr] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [okMsg, setOkMsg] = useState('');

  const [engine, setEngine] = useState('');
  const [group, setGroup] = useState(3);
  const [skipVideo, setSkipVideo] = useState(true);

  const [narrator, setNarrator] = useState('');
  const [defaultSpeaker, setDefaultSpeaker] = useState('');
  const [voices, setVoices] = useState<VoiceRuleRow[]>([]);
  const [prons, setProns] = useState<PronRow[]>([]);
  const [castText, setCastText] = useState('');
  const [sceneStyle, setSceneStyle] = useState('');
  const [sceneCharacters, setSceneCharacters] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const c = await api<BookConfig>(`/audiobook/books/${bookId}/config`);
        setCfg(c);
        if (c.presets) {
          setEngine(c.presets.engine);
          setGroup(c.presets.chaptersPerEpisode);
          setSkipVideo(c.presets.skipVideo);
        }
        setNarrator(c.project.narrator ?? '');
        setDefaultSpeaker(c.project.defaultSpeaker ?? '');
        setVoices(c.project.voiceBySpeaker ?? []);
        setProns(c.project.pron ?? []);
        setCastText((c.project.cast ?? []).join('、'));
        setSceneStyle(c.project.sceneStyle ?? '');
        setSceneCharacters(c.project.sceneCharacters ?? '');
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [bookId]);

  const savePresets = async () => {
    setSavingPreset(true); setErr(''); setOkMsg('');
    try {
      await apiPut(`/audiobook/books/${bookId}/config/presets`, { engine, chaptersPerEpisode: String(group), skipVideo });
      setOkMsg('制作预设已保存，下一集制作即生效');
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setSavingPreset(false); }
  };

  const saveProject = async () => {
    setSavingProject(true); setErr(''); setOkMsg('');
    const cast = castText.split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean);
    const body: BookConfig['project'] = {
      ...(voices.length ? { voiceBySpeaker: voices.filter((v) => v.match.trim() && v.voice) } : {}),
      ...(prons.length ? { pron: prons.filter((p) => p.match.trim() && p.read.trim()) } : {}),
      ...(cast.length ? { cast } : {}),
      ...(narrator ? { narrator } : {}),
      ...(defaultSpeaker ? { defaultSpeaker } : {}),
      ...(sceneStyle.trim() ? { sceneStyle: sceneStyle.trim() } : {}),
      ...(sceneCharacters.trim() ? { sceneCharacters: sceneCharacters.trim() } : {}),
    };
    try {
      await apiPut(`/audiobook/books/${bookId}/config/project`, body);
      setOkMsg('发音与班底已保存；改动的段落下次制作会自动重录（内容指纹缓存）');
    } catch (e) { setErr((e as Error).message); } finally { setSavingProject(false); }
  };

  if (err && !cfg) return <div className="ab-config-card"><div className="ab-error">{err}</div></div>;
  if (!cfg) return <div className="ab-config-card"><div className="ab-empty">加载中…</div></div>;

  const voiceSelect = (value: string, onChange: (v: string) => void) => (
    <select className="ab-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">（默认）</option>
      {cfg.voices.map((v) => <option key={v.voice} value={v.voice}>{v.label}</option>)}
    </select>
  );

  return (
    <div className="ab-config-card">
      <div className="ab-config-head">
        <h2 className="ab-config-title"><span className="msr msr-sm">tune</span> 本书配置</h2>
        <button className="ab-btn" onClick={onClose}>收起</button>
      </div>

      {/* ── 制作预设（registry）：影响下一集制作 ── */}
      <section className="ab-config-section">
        <h3 className="ab-config-h">制作预设 <span className="ab-hint">下一集制作时生效</span></h3>
        {!cfg.presets && <p className="ab-hint">尚未开启有声书，先在上方一键开启后再来调整。</p>}
        {cfg.presets && (
          <div className="ab-config-grid">
            <label>配音引擎
              <select className="ab-input" value={engine} onChange={(e) => setEngine(e.target.value)}>
                {Object.entries(ENGINE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>每集章数
              <select className="ab-input" value={String(group)} onChange={(e) => setGroup(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} 章</option>)}
              </select>
            </label>
            <label className="ab-check ab-config-check">
              <input type="checkbox" checked={skipVideo} onChange={(e) => setSkipVideo(e.target.checked)} />
              纯音频（不渲染视频）
            </label>
            <div className="ab-config-save">
              <button className="ab-btn ab-btn-primary" disabled={savingPreset} onClick={() => void savePresets()}>
                {savingPreset ? '保存中…' : '保存预设'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── 内容工程（projects/<书名>.json）：发音与班底 ── */}
      <section className="ab-config-section">
        <h3 className="ab-config-h">发音与班底 <span className="ab-hint">保存后，受影响段落下次制作自动重录</span></h3>

        <div className="ab-config-grid">
          <label>旁白音色{voiceSelect(narrator, setNarrator)}</label>
          <label>对白默认音色{voiceSelect(defaultSpeaker, setDefaultSpeaker)}</label>
        </div>

        <div className="ab-config-sub">音色班底（角色 → 音色，可微调语速/音调）</div>
        <div className="ab-config-rows">
          {voices.map((r, i) => (
            <div key={i} className="ab-config-row">
              <input className="ab-input ab-input-mini" placeholder="角色名（含）" value={r.match}
                onChange={(e) => setVoices((prev) => prev.map((x, j) => j === i ? { ...x, match: e.target.value } : x))} />
              {voiceSelect(r.voice, (v) => setVoices((prev) => prev.map((x, j) => j === i ? { ...x, voice: v } : x)))}
              <input className="ab-input ab-input-mini" placeholder="语速 -14%" value={r.rate ?? ''}
                onChange={(e) => setVoices((prev) => prev.map((x, j) => j === i ? { ...x, rate: e.target.value || undefined } : x))} />
              <input className="ab-input ab-input-mini" placeholder="音调 -10Hz" value={r.pitch ?? ''}
                onChange={(e) => setVoices((prev) => prev.map((x, j) => j === i ? { ...x, pitch: e.target.value || undefined } : x))} />
              <button className="ab-btn" title="删除该行" onClick={() => setVoices((prev) => prev.filter((_, j) => j !== i))}>
                <span className="msr msr-sm">delete</span>
              </button>
            </div>
          ))}
          <button className="ab-btn" onClick={() => setVoices((prev) => [...prev, { match: '', voice: '' }])}>
            <span className="msr msr-sm">add</span> 加一个角色
          </button>
        </div>

        <div className="ab-config-sub">发音表（字面 → 读作，如 110 → 幺幺零）</div>
        <div className="ab-config-rows">
          {prons.map((r, i) => (
            <div key={i} className="ab-config-row">
              <input className="ab-input ab-input-mini" placeholder="字面" value={r.match}
                onChange={(e) => setProns((prev) => prev.map((x, j) => j === i ? { ...x, match: e.target.value } : x))} />
              <span className="ab-config-arrow">→</span>
              <input className="ab-input ab-input-mini" placeholder="读作" value={r.read}
                onChange={(e) => setProns((prev) => prev.map((x, j) => j === i ? { ...x, read: e.target.value } : x))} />
              <button className="ab-btn" title="删除该行" onClick={() => setProns((prev) => prev.filter((_, j) => j !== i))}>
                <span className="msr msr-sm">delete</span>
              </button>
            </div>
          ))}
          <button className="ab-btn" onClick={() => setProns((prev) => [...prev, { match: '', read: '' }])}>
            <span className="msr msr-sm">add</span> 加一条发音
          </button>
        </div>

        <div className="ab-config-grid">
          <label>角色名单（、分隔；含别名，用于归属校验）
            <input className="ab-input" value={castText} placeholder="例：老周、周队、小马" onChange={(e) => setCastText(e.target.value)} />
          </label>
        </div>

        <details className="ab-config-advanced">
          <summary className="ab-config-sub">场景图指令（高级，英文生图提示词）</summary>
          <label>整体风格<textarea className="ab-input" rows={2} value={sceneStyle} onChange={(e) => setSceneStyle(e.target.value)} /></label>
          <label>角色/场景一致性表<textarea className="ab-input" rows={3} value={sceneCharacters} onChange={(e) => setSceneCharacters(e.target.value)} /></label>
        </details>

        <div className="ab-config-save">
          <button className="ab-btn ab-btn-primary" disabled={savingProject} onClick={() => void saveProject()}>
            {savingProject ? '保存中…' : '保存发音与班底'}
          </button>
        </div>
      </section>

      {err && <div className="ab-error">{err}</div>}
      {okMsg && <div className="ab-ok-msg"><span className="msr msr-sm">check_circle</span> {okMsg}</div>}
    </div>
  );
}
