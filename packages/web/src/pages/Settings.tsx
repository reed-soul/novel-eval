import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, type EngineInfo, type EngineConfigResponse } from '../api/client.ts';

const PROVIDER_LABEL: Record<string, string> = {
  bigmodel: '智谱 GLM',
  deepseek: 'DeepSeek',
};

// 各 provider 推荐的模型列表（供下拉选择）
const MODELS: Record<string, string[]> = {
  bigmodel: ['glm-5.2'],
  deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash'],
};

export function Settings() {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [active, setActive] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // 各 provider 的 key 输入框（不回显，安全）
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  // 各引擎的模型覆盖输入
  const [modelInputs, setModelInputs] = useState<Record<string, string>>({});
  const [healthStatus, setHealthStatus] = useState<string>('');

  const reload = () => {
    api<EngineConfigResponse>('/config/engine')
      .then((data) => {
        setEngines(data.engines);
        setActive(data.active);
        const models: Record<string, string> = {};
        for (const e of data.engines) models[e.name] = e.model;
        setModelInputs(models);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(reload, []);

  const switchEngine = async (name: string) => {
    setMessage('');
    setError('');
    const res = await fetch('/api/config/engine', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        active: name,
        models: { [name]: modelInputs[name] },
      }),
    });
    const data = await res.json();
    if (data.error) { setError(data.error); return; }
    setActive(data.active);
    setEngines(data.engines);
    setMessage(`已切换到 ${name}`);
  };

  const saveKey = async (provider: string) => {
    setMessage('');
    setError('');
    const key = keyInputs[provider];
    if (!key) { setError('请输入 API key'); return; }
    const res = await fetch('/api/config/engine/keys', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, key }),
    });
    const data = await res.json();
    if (data.error) { setError(data.error); return; }
    setKeyInputs({ ...keyInputs, [provider]: '' });
    setMessage(`${PROVIDER_LABEL[provider] ?? provider} 的 API key 已保存`);
    reload();
  };

  const checkHealth = async () => {
    setHealthStatus('检测中...');
    try {
      const data = await api<{ available: boolean; engine: string; model: string }>('/config/engine/health');
      setHealthStatus(data.available
        ? `✅ ${data.engine} (${data.model}) 可用`
        : `⚠️ ${data.engine} 未配置 API key`);
    } catch (e) {
      setHealthStatus(`❌ 检测失败：${(e as Error).message}`);
    }
  };

  if (loading) return <div className="container loading">加载中...</div>;

  return (
    <div className="container">
      <div className="header">
        <h1>⚙️ 模型配置</h1>
        <Link to="/">← 返回列表</Link>
      </div>

      <div className="card">
        <h2>当前引擎</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 12 }}>
          选择用于生成小说的 AI 模型。切换后立即生效，影响后续所有生成操作。
        </p>
        <div style={{ display: 'grid', gap: 12 }}>
          {engines.map((e) => (
            <div
              key={e.name}
              style={{
                border: active === e.name ? '2px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: 8,
                padding: 16,
                background: active === e.name ? 'var(--bg-secondary)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong style={{ fontSize: 16 }}>{PROVIDER_LABEL[e.provider] ?? e.provider}</strong>
                  <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 13 }}>{e.name}</span>
                  {active === e.name && <span className="badge badge-active" style={{ marginLeft: 8 }}>当前</span>}
                </div>
                <span style={{ fontSize: 13, color: e.hasKey ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)' }}>
                  {e.hasKey ? '🔑 已配置' : '🔒 未配置 key'}
                </span>
              </div>

              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontSize: 14 }}>模型：</label>
                <select
                  className="input"
                  style={{ width: 'auto', minWidth: 200 }}
                  value={modelInputs[e.name] ?? e.model}
                  onChange={(ev) => setModelInputs({ ...modelInputs, [e.name]: ev.target.value })}
                >
                  {(MODELS[e.provider] ?? [e.model]).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                {active !== e.name && (
                  <button className="btn btn-primary" onClick={() => switchEngine(e.name)}>设为当前</button>
                )}
              </div>

              <div style={{ marginTop: 12 }}>
                <input
                  className="input"
                  type="password"
                  placeholder={`${PROVIDER_LABEL[e.provider] ?? e.provider} API key（${e.hasKey ? '已配置，可覆盖' : '未配置'}）`}
                  value={keyInputs[e.provider] ?? ''}
                  onChange={(ev) => setKeyInputs({ ...keyInputs, [e.provider]: ev.target.value })}
                />
                <button className="btn" style={{ marginTop: 8 }} onClick={() => saveKey(e.provider)}>
                  保存 Key
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>连通性检测</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn" onClick={checkHealth}>检测当前引擎</button>
          {healthStatus && <span style={{ fontSize: 14 }}>{healthStatus}</span>}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {message && <div className="card" style={{ borderLeft: '3px solid var(--success, #16a34a)' }}>{message}</div>}

      <div className="card">
        <h2>说明</h2>
        <ul style={{ lineHeight: 1.8, color: 'var(--muted)', fontSize: 14, paddingLeft: 20 }}>
          <li><strong>智谱 GLM</strong>（glm-5.2）：默认引擎，中文写作质量稳定，成本约 ¥2.4/本（50 章）。</li>
          <li><strong>DeepSeek</strong>（deepseek-v4-pro / v4-flash）：中文理解强，pro 为最强模型，flash 更快更省。</li>
          <li>API key 仅保存在服务端内存，重启后需重新输入（或写入 ~/.claude/settings.json 的 env 字段持久化）。</li>
          <li>切换引擎后，已生成的项目内容不受影响，仅影响后续生成调用。</li>
        </ul>
      </div>
    </div>
  );
}
