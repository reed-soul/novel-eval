import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Logo } from './Logo.tsx';

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
          <nav className="global-nav" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
              📚 项目列表
            </Link>
            <Link to="/settings" className={`nav-link ${location.pathname === '/settings' ? 'active' : ''}`}>
              ⚙️ 模型配置
            </Link>
            <button 
              className="theme-toggle-btn" 
              onClick={toggleTheme} 
              aria-label="Toggle Theme"
              style={{
                background: 'none',
                border: 'none',
                fontSize: 18,
                cursor: 'pointer',
                padding: 4,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
          </nav>
        </div>
      </header>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
