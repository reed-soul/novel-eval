import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Project } from '../api/client.ts';

type StatusFilter = 'all' | 'writing' | 'completed' | 'hasAudio';
type SortOrder = 'created_desc' | 'created_asc' | 'title';
type ViewMode = 'grid' | 'list';

function getGenreAtmosphereClass(genre: string): string {
  if (/悬疑|犯罪|推理|惊悚|微恐/.test(genre)) return 'jacket-atmosphere-suspense';
  if (/科幻|未来|太空|赛博|硬核/.test(genre)) return 'jacket-atmosphere-scifi';
  if (/现实|社会|都市|家庭|商战/.test(genre)) return 'jacket-atmosphere-urban';
  if (/奇幻|仙侠|修仙|古风|权谋|传奇/.test(genre)) return 'jacket-atmosphere-fantasy';
  return 'jacket-atmosphere-default';
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'completed': return '已完结';
    case 'writing': return '连载中';
    case 'planning': return '规划中';
    case 'draft': return '大纲草稿';
    case 'archived': return '已归档';
    default: return status;
  }
}

export function ProjectList() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [abLines, setAbLines] = useState<Record<string, { episodeCount: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('created_desc');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProjects = () => {
    api<Project[]>('/projects')
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    
    api<{ lines: Record<string, { episodeCount: number }> }>('/audiobook/lines')
      .then((r) => setAbLines(r.lines || {}))
      .catch(() => undefined);
  };

  useEffect(() => {
    fetchProjects();
    pollRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') fetchProjects();
    }, 6000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Studio Metrics
  const metrics = useMemo(() => {
    const total = projects.length;
    const completed = projects.filter((p) => p.status === 'completed').length;
    const writing = projects.filter((p) => p.status === 'writing' || p.status === 'planning' || p.status === 'draft').length;
    const audioLinesCount = Object.keys(abLines).length;
    const totalEpisodes = Object.values(abLines).reduce((acc, cur) => acc + (cur.episodeCount || 0), 0);
    return { total, completed, writing, audioLinesCount, totalEpisodes };
  }, [projects, abLines]);

  // Filtered & Sorted Projects
  const filteredProjects = useMemo(() => {
    return projects
      .filter((p) => {
        // Status filter
        if (statusFilter === 'writing') {
          if (p.status === 'completed') return false;
        } else if (statusFilter === 'completed') {
          if (p.status !== 'completed') return false;
        } else if (statusFilter === 'hasAudio') {
          if (!abLines[p.id]) return false;
        }

        // Search query
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          p.title.toLowerCase().includes(q) ||
          p.premise.toLowerCase().includes(q) ||
          (p.genreProfile && p.genreProfile.toLowerCase().includes(q)) ||
          (p.targetAudience && p.targetAudience.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (sortOrder === 'created_desc') {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        if (sortOrder === 'created_asc') {
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }
        if (sortOrder === 'title') {
          return a.title.localeCompare(b.title, 'zh-CN');
        }
        return 0;
      });
  }, [projects, abLines, statusFilter, searchQuery, sortOrder]);

  if (loading) {
    return (
      <div className="container" style={{ padding: '80px 20px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, color: 'var(--text-muted)' }}>
          <span className="msr msr-sm" style={{ animation: 'spin 1s linear infinite' }}>progress_activity</span>
          <span>正在加载叙事工坊书架…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container" style={{ padding: '40px 20px' }}>
        <div className="card" style={{ borderColor: 'var(--red)', background: 'rgba(239, 68, 68, 0.05)' }}>
          <h2 style={{ color: 'var(--red)', borderLeftColor: 'var(--red)' }}>工坊数据同步异常</h2>
          <p style={{ color: 'var(--text-muted)', margin: '8px 0 16px' }}>{error}</p>
          <button className="btn btn-primary" onClick={fetchProjects}>重试同步</button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      {/* 1. Studio Hero Bento Grid */}
      <div className="studio-hero-bento">
        <div className="bento-stat-card">
          <div className="bento-stat-top">
            <span>典藏长篇总库</span>
            <span className="msr bento-stat-icon">auto_stories</span>
          </div>
          <div className="bento-stat-val">
            {metrics.total} <span className="bento-stat-unit">部作品</span>
          </div>
          <div className="bento-stat-desc">
            {metrics.completed} 部全本完结 · {metrics.writing} 部连载研创中
          </div>
        </div>

        <div className="bento-stat-card">
          <div className="bento-stat-top">
            <span>多模态有声资产</span>
            <span className="msr bento-stat-icon">graphic_eq</span>
          </div>
          <div className="bento-stat-val">
            {metrics.audioLinesCount} <span className="bento-stat-unit">条工坊管线</span>
          </div>
          <div className="bento-stat-desc">
            累计已制成 {metrics.totalEpisodes} 集全景声广播与视频
          </div>
        </div>

        <div className="bento-stat-card">
          <div className="bento-stat-top">
            <span>全书叙事质检</span>
            <span className="msr bento-stat-icon">verified</span>
          </div>
          <div className="bento-stat-val">
            8 维 <span className="bento-stat-unit">雷达评估</span>
          </div>
          <div className="bento-stat-desc">
            剧情逻辑断裂检测 · 伏笔网闭环追踪
          </div>
        </div>

        <div className="bento-stat-card">
          <div className="bento-stat-top">
            <span>多格式发行矩阵</span>
            <span className="msr bento-stat-icon">ios_share</span>
          </div>
          <div className="bento-stat-val">
            一键 <span className="bento-stat-unit">全端导出</span>
          </div>
          <div className="bento-stat-desc">
            TXT / Markdown / 起点与番茄平台分卷 ZIP
          </div>
        </div>
      </div>

      {/* 2. Studio Toolbar */}
      <div className="studio-toolbar">
        <div className="studio-toolbar-left">
          {/* Search Box */}
          <div className="studio-search-wrapper">
            <span className="msr studio-search-icon">search</span>
            <input
              type="text"
              className="studio-search-input"
              placeholder="搜索书名、题材或剧情主题…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="studio-search-clear" onClick={() => setSearchQuery('')} title="清除搜索">
                <span className="msr msr-sm">close</span>
              </button>
            )}
          </div>

          {/* Segmented Filter */}
          <div className="segmented-control" role="tablist">
            <button
              className={`segmented-item ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              全部 ({metrics.total})
            </button>
            <button
              className={`segmented-item ${statusFilter === 'writing' ? 'active' : ''}`}
              onClick={() => setStatusFilter('writing')}
            >
              连载中 ({metrics.writing})
            </button>
            <button
              className={`segmented-item ${statusFilter === 'completed' ? 'active' : ''}`}
              onClick={() => setStatusFilter('completed')}
            >
              已完结 ({metrics.completed})
            </button>
            <button
              className={`segmented-item ${statusFilter === 'hasAudio' ? 'active' : ''}`}
              onClick={() => setStatusFilter('hasAudio')}
            >
              有声书 ({metrics.audioLinesCount})
            </button>
          </div>
        </div>

        <div className="studio-toolbar-right">
          {/* Sort Selector */}
          <select
            className="sort-select"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
          >
            <option value="created_desc">最新创建</option>
            <option value="created_asc">最早创建</option>
            <option value="title">书名 A-Z</option>
          </select>

          {/* View Mode Toggle */}
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="封面画廊视图"
            >
              <span className="msr msr-sm">grid_view</span>
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="紧凑表格视图"
            >
              <span className="msr msr-sm">format_list_bulleted</span>
            </button>
          </div>

          {/* New Book CTA */}
          <Link to="/projects/new" style={{ textDecoration: 'none' }}>
            <button className="btn btn-primary" style={{ padding: '8px 16px', borderRadius: 10 }}>
              <span className="msr msr-sm" style={{ fontWeight: 'bold' }}>add</span> 新建作品
            </button>
          </Link>
        </div>
      </div>

      {/* 3. Project Content Views */}
      {projects.length === 0 ? (
        <div className="studio-empty-state">
          <span className="msr studio-empty-icon">menu_book</span>
          <h3 className="studio-empty-title">工坊书架虚位以待</h3>
          <p className="studio-empty-desc">
            尚未创建长篇作品。从设定世界观 Bible 与故事蓝图大纲开始，开启你的第一部 AI 原生力作。
          </p>
          <Link to="/projects/new">
            <button className="btn btn-primary" style={{ padding: '10px 24px' }}>
              <span className="msr msr-sm">edit_note</span> 立即立项新作品
            </button>
          </Link>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="studio-empty-state">
          <span className="msr studio-empty-icon" style={{ opacity: 0.4 }}>filter_alt_off</span>
          <h3 className="studio-empty-title">未找到匹配的长篇作品</h3>
          <p className="studio-empty-desc">
            没有符合当前筛选条件“{searchQuery || statusFilter}”的作品，请尝试放宽筛选或清除搜索词。
          </p>
          <button
            className="btn"
            onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
          >
            重置所有筛选
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        /* Grid View: Apple Editorial Book Cards */
        <div className="editorial-book-grid">
          {filteredProjects.map((p) => {
            const line = abLines[p.id];
            const atmosphereClass = getGenreAtmosphereClass(p.genreProfile || '');
            const isCompleted = p.status === 'completed';

            return (
              <div
                key={p.id}
                className="editorial-book-card"
                onClick={() => navigate(`/books/${p.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/books/${p.id}`); }}
              >
                {/* Book Cover Jacket */}
                <div className={`book-cover-jacket ${atmosphereClass}`}>
                  <div className="jacket-top-row">
                    <span className="jacket-genre-badge">
                      {p.genreProfile} {p.targetAudience ? `· ${p.targetAudience}` : ''}
                    </span>
                    <span className={`jacket-status-chip ${isCompleted ? 'jacket-status-completed' : p.status === 'writing' ? 'jacket-status-writing' : 'jacket-status-draft'}`}>
                      {getStatusLabel(p.status)}
                    </span>
                  </div>
                  <div className="jacket-title-area">
                    <h3 className="jacket-book-title">{p.title}</h3>
                  </div>
                </div>

                {/* Card Content & Premise */}
                <div className="book-card-content">
                  <p className="book-card-premise" title={p.premise}>
                    {p.premise || '暂无故事概述与主题设定。'}
                  </p>

                  {/* Multi-modal capability pills */}
                  <div className="multimodal-tags-row">
                    {line && (
                      <span
                        className="multimodal-chip multimodal-chip-audio"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/books/${p.id}/audiobook`);
                        }}
                        title="点击直达有声书工作台"
                      >
                        <span className="msr msr-sm">graphic_eq</span>
                        <span>有声书 · {line.episodeCount} 集</span>
                      </span>
                    )}

                    {isCompleted && (
                      <span
                        className="multimodal-chip multimodal-chip-eval"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/books/${p.id}/quality`);
                        }}
                        title="查看全书质检分析报告"
                      >
                        <span className="msr msr-sm">verified</span>
                        <span>质检分析</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Footer Strip */}
                <div className="book-card-footer">
                  <span className="book-card-footer-date">
                    立项: {p.createdAt.slice(0, 10)}
                  </span>
                  <span className="book-card-open-btn">
                    进入工坊 <span className="msr msr-sm">arrow_forward</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List View: Apple Pro Table */
        <div className="editorial-table-wrapper">
          <table className="editorial-table">
            <thead>
              <tr>
                <th style={{ width: '28%' }}>作品名称</th>
                <th style={{ width: '18%' }}>题材设定</th>
                <th style={{ width: '12%' }}>状态</th>
                <th style={{ width: '18%' }}>多模态衍生</th>
                <th style={{ width: '12%' }}>立项时间</th>
                <th style={{ width: '12%', textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p) => {
                const line = abLines[p.id];
                const isCompleted = p.status === 'completed';

                return (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/books/${p.id}`} style={{ fontWeight: 600, color: 'var(--text)' }}>
                        {p.title}
                      </Link>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 300 }}>
                        {p.premise}
                      </div>
                    </td>
                    <td>
                      <span className="jacket-genre-badge">{p.genreProfile} · {p.targetAudience}</span>
                    </td>
                    <td>
                      <span className={`jacket-status-chip ${isCompleted ? 'jacket-status-completed' : p.status === 'writing' ? 'jacket-status-writing' : 'jacket-status-draft'}`}>
                        {getStatusLabel(p.status)}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {line ? (
                          <Link to={`/books/${p.id}/audiobook`} className="multimodal-chip multimodal-chip-audio">
                            <span className="msr msr-sm">graphic_eq</span> {line.episodeCount} 集
                          </Link>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>未建线</span>
                        )}
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                      {p.createdAt.slice(0, 10)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link to={`/books/${p.id}`} className="btn" style={{ padding: '4px 10px', fontSize: 12 }}>
                        工坊 →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
