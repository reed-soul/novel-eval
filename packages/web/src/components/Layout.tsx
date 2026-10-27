import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Logo } from './Logo.tsx';
import { ActiveJobsBanner } from './ActiveJobsBanner.tsx';

export function Layout() {
  const location = useLocation();
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (localStorage.getItem('theme') as 'light' | 'dark') || 'dark'
  );

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light-theme');
    } else {
      document.documentElement.classList.remove('light-theme');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };
  
  return (
    <div className="app-layout">
      <header className="global-header">
        <div className="header-container">
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Logo />
          </Link>
          <nav className="global-nav" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link to="/" className={`nav-link ${location.pathname === '/' || location.pathname.startsWith('/books') ? 'active' : ''}`}>
              <span className="msr msr-sm">auto_stories</span> 书架工坊
            </Link>
            <Link to="/eval" className={`nav-link ${location.pathname.startsWith('/eval') ? 'active' : ''}`}>
              <span className="msr msr-sm">analytics</span> 全书评估
            </Link>
            <Link to="/audit" className={`nav-link ${location.pathname.startsWith('/audit') ? 'active' : ''}`}>
              <span className="msr msr-sm">troubleshoot</span> 剧情审计
            </Link>
            <Link to="/settings" className={`nav-link ${location.pathname === '/settings' ? 'active' : ''}`}>
              <span className="msr msr-sm">tune</span> 引擎配置
            </Link>
            <button
              className="theme-toggle-btn"
              onClick={toggleTheme}
              aria-label="Toggle Theme"
              title={theme === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
              style={{
                background: 'var(--btn-bg)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                fontSize: 14,
                cursor: 'pointer',
                padding: '6px 10px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                marginLeft: 4,
                transition: 'all 0.2s',
              }}
            >
              <span className="msr msr-sm">{theme === 'light' ? 'dark_mode' : 'light_mode'}</span>
            </button>
          </nav>
        </div>
      </header>
      <ActiveJobsBanner />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
