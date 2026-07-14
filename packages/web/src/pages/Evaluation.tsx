import React, { useState, useEffect } from 'react';
import { ProgressPanel } from '../components/ProgressPanel.tsx';
import { useNavigate } from 'react-router-dom';

export function Evaluation() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  
  const [taskId, setTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');

  // Load existing projects for convenience
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(data => setProjects(data.projects || []))
      .catch(e => console.error('Failed to load projects:', e));
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
      // 可选：添加 genre 和 audience

      const res = await fetch('/api/eval/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('上传失败');
      
      const data = await res.json();
      setTaskId(data.taskId);
    } catch (err: any) {
      setStatus('failed');
      setLogs(prev => [...prev, `[系统错误] ${err.message}`]);
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

    eventSource.addEventListener('error', (e: any) => {
      setStatus('failed');
      setLogs(prev => [...prev, `[系统错误] 评估中断或失败`]);
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }, [taskId, status, navigate]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-accent-primary to-accent-secondary">
        智能作品评估 (Map-Reduce)
      </h1>
      <p className="text-text-secondary mb-8">
        采用多维度 Map-Reduce 架构，深度解析小说的故事架构、人物塑造与商业潜力。
      </p>

      {status === 'idle' && (
        <div className="glass-panel rounded-xl overflow-hidden shadow-lg border border-border-dim bg-bg-secondary/50 p-6">
          <h2 className="text-xl font-bold mb-6">新建评估任务</h2>
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-secondary">选项 1：直接上传本地 TXT 小说</label>
              <input 
                type="file" 
                accept=".txt"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-text-secondary
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-semibold
                  file:bg-bg-tertiary file:text-text-primary
                  hover:file:bg-bg-elevated transition-colors
                  border border-border-dim rounded-md p-2 bg-bg-secondary"
              />
            </div>

            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-border-dim"></div>
              <span className="flex-shrink-0 mx-4 text-text-muted text-sm">OR</span>
              <div className="flex-grow border-t border-border-dim"></div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-secondary">选项 2：选择已有工作区项目</label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full bg-bg-primary border border-border-dim rounded-md px-3 py-2 text-text-primary focus:outline-none focus:border-accent-primary"
              >
                <option value="">-- 请选择项目 --</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.title} ({p.status})</option>
                ))}
              </select>
            </div>

            <button 
              onClick={handleUpload} 
              className="w-full mt-4 bg-accent-primary text-black font-bold py-2 px-4 rounded-md disabled:opacity-50"
              disabled={!file && !selectedProjectId}
            >
              开始深度评估
            </button>
          </div>
        </div>
      )}

      {(status === 'running' || status === 'completed' || status === 'failed') && (
        <ProgressPanel logs={logs} status={status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'running'} />
      )}
    </div>
  );
}
