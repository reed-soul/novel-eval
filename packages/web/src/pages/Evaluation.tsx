import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '../api/client.ts';

export function Evaluation() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  
  // New input states
  const [genre, setGenre] = useState<string>('都市');
  const [audience, setAudience] = useState<string>('大众');
  const [profile, setProfile] = useState<string>('default');

  const [taskId, setTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');

  // Load existing projects for convenience
  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data: unknown) => setProjects(Array.isArray(data) ? data.filter(isProject) : []))
      .catch((e: unknown) => console.error('Failed to load projects:', e));
  }, []);

  const handleUpload = async () => {
    if (!file && !selectedProjectId) {
      alert('请上传一个 txt 文件，或者选择一个现有的项目进行评估');
      return;
    }

    setStatus('running');
    setLogs(['[系统] 正在准备评估任务...']);

    try {
      let uploadFile = file;

      // 如果选了项目但没上传文件，尝试从服务端导出一份临时 txt 供上传
      if (!uploadFile && selectedProjectId) {
        setLogs(prev => [...prev, `[系统] 正在打包项目 ${selectedProjectId} 的正文...`]);
        const res = await fetch(`/api/projects/${selectedProjectId}/export?format=txt`);
        if (!res.ok) throw new Error('打包失败');
        const blob = await res.blob();
        uploadFile = new File([blob], `${selectedProjectId}.txt`, { type: 'text/plain' });
      }

      const formData = new FormData();
      formData.append('file', uploadFile as Blob);
      formData.append('genre', genre);
      formData.append('audience', audience);
      formData.append('profile', profile);

      const res = await fetch('/api/eval/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('上传失败');
      
      const data: unknown = await res.json();
      if (!isUploadResponse(data)) throw new Error('评估任务返回缺少 taskId');
      setTaskId(data.taskId);
    } catch (err: unknown) {
      setStatus('failed');
      const message = err instanceof Error ? err.message : String(err);
      setLogs(prev => [...prev, `[系统错误] ${message}`]);
    }
  };

  // SSE 监听
  useEffect(() => {
    if (!taskId || status !== 'running') return;

    const eventSource = new EventSource(`/api/eval/${taskId}/stream`);

    eventSource.addEventListener('progress', (e) => {
      setLogs(prev => [...prev, e.data]);
    });

    eventSource.addEventListener('done', () => {
      setStatus('completed');
      setLogs(prev => [...prev, '[系统] 评估完成！正在跳转至报告页...']);
      eventSource.close();
      
      // 稍微延迟一下让用户看到完成消息
      setTimeout(() => {
        navigate(`/eval/${taskId}`);
      }, 1500);
    });

    eventSource.addEventListener('error', () => {
      setStatus('failed');
      setLogs(prev => [...prev, `[系统错误] 评估中断或失败`]);
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }, [taskId, status, navigate]);

  return (
    <div className="container">
      <div className="eval-title">
        智能作品评估 (Map-Reduce)
      </div>
      <div className="eval-subtitle">
        采用八维 Map-Reduce 架构，解析故事、人物、文笔、情绪、市场、主题、原创性与节奏留存。
      </div>

      {status === 'idle' && (
        <div className="card">
          <h2 style={{ marginBottom: 20 }}>新建评估任务</h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Input Selection Panels */}
            <div className="eval-form-grid">
              <div className="eval-form-group">
                <label>小说类型 (Genre)</label>
                <input 
                  type="text" 
                  className="input" 
                  value={genre} 
                  onChange={(e) => setGenre(e.target.value)} 
                  placeholder="如：科幻, 玄幻, 悬疑, 都市言情"
                />
              </div>
              <div className="eval-form-group">
                <label>目标受众 (Audience)</label>
                <input 
                  type="text" 
                  className="input" 
                  value={audience} 
                  onChange={(e) => setAudience(e.target.value)} 
                  placeholder="如：青年男性, 大众, 女性向"
                />
              </div>
            </div>

            <div className="eval-form-group">
              <label>评估模式 (Profile)</label>
              <select 
                className="input" 
                value={profile} 
                onChange={(e) => setProfile(e.target.value)}
              >
                <option value="default">标准综合评估 (default)</option>
                <option value="revision">深度改稿指引模式 (revision)</option>
                <option value="submission">出版社投稿审查模式 (submission)</option>
              </select>
            </div>

            <div className="eval-divider">选择小说来源</div>

            <div className="eval-form-group">
              <label>方式 A：直接上传本地 TXT 小说</label>
              <div className={`upload-zone ${file ? 'has-file' : ''}`}>
                <input 
                  type="file" 
                  accept=".txt"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] || null);
                    if (e.target.files?.[0]) {
                      setSelectedProjectId('');
                    }
                  }}
                  className="upload-input"
                />
                <div className="upload-content">
                  <div className="upload-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div className="upload-text">
                    {file ? (
                      <>
                        <span className="file-name">{file.name}</span>
                        <span className="file-size">({(file.size / 1024).toFixed(1)} KB)</span>
                      </>
                    ) : (
                      <>
                        <span className="upload-prompt">点击或拖拽 TXT 文件到此处</span>
                        <span className="upload-hint">支持 .txt 格式，建议包含明确的分卷和章节标记</span>
                      </>
                    )}
                  </div>
                  {file && (
                    <button 
                      type="button" 
                      className="upload-clear-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setFile(null);
                      }}
                    >
                      清除文件
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="eval-divider">OR</div>

            <div className="eval-form-group">
              <label>方式 B：选择已有工作区项目进行评估</label>
              <select
                value={selectedProjectId}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  if (e.target.value) {
                    setFile(null);
                  }
                }}
                className="input"
              >
                <option value="">-- 请选择项目 --</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.title} ({p.status})</option>
                ))}
              </select>
            </div>

            <button 
              onClick={handleUpload} 
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 10, padding: '12px' }}
              disabled={!file && !selectedProjectId}
            >
              🚀 开始深度评估
            </button>
          </div>
        </div>
      )}

      {(status === 'running' || status === 'completed' || status === 'failed') && (
        <div className="card">
          <h2>
            评估进度{' '}
            {status === 'running' && '⏳ 运行中'}
            {status === 'completed' && '✅ 评估完成'}
            {status === 'failed' && '❌ 评估失败'}
          </h2>
          <div style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8, marginTop: 8, maxHeight: '60vh', overflowY: 'auto' }}>
            {logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function isProject(value: unknown): value is Project {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return 'id' in value
    && 'title' in value
    && typeof value.id === 'string'
    && typeof value.title === 'string';
}

function isUploadResponse(value: unknown): value is { taskId: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return 'taskId' in value && typeof value.taskId === 'string';
}
