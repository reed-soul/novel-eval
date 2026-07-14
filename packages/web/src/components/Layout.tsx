import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Logo } from './Logo.tsx';

export function Layout() {
  const location = useLocation();
  
  return (
    <div className="app-layout">
      <header className="global-header">
        <div className="header-container">
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Logo />
          </Link>
          <nav className="global-nav">
            <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}>
              📚 项目列表
            </Link>
            <Link to="/settings" className={`nav-link ${location.pathname === '/settings' ? 'active' : ''}`}>
              ⚙️ 模型配置
            </Link>
          </nav>
        </div>
      </header>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
