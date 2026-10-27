/**
 * 书工作台 Tab 条：写作 | 有声书 | 解说（M3）| 短篇（M2）| 质检——书内唯一层级导航。
 * 从 /books/:id 下任意子页都能一步切形态。
 */
import React from 'react';
import { Link, useParams } from 'react-router-dom';

export type BookTabKey = 'writing' | 'state' | 'audiobook' | 'narration' | 'digest' | 'quality' | 'dashboard';

export function BookTabs({ active }: { active: BookTabKey }) {
  const { id = '' } = useParams();
  const tabs: { key: BookTabKey; to: string; label: string; icon: string }[] = [
    { key: 'writing', to: `/books/${id}`, label: '写作工坊', icon: 'edit_note' },
    { key: 'state', to: `/books/${id}/state`, label: '设定大纲', icon: 'menu_book' },
    { key: 'audiobook', to: `/books/${id}/audiobook`, label: '有声书', icon: 'graphic_eq' },
    { key: 'narration', to: `/books/${id}/narration`, label: '影视解说', icon: 'smart_display' },
    { key: 'digest', to: `/books/${id}/digest`, label: '短篇', icon: 'short_text' },
    { key: 'quality', to: `/books/${id}/quality`, label: '质检', icon: 'verified' },
    { key: 'dashboard', to: `/books/${id}/dashboard`, label: '仪表盘', icon: 'speed' },
  ];
  return (
    <div className="book-tabs" role="tablist">
      <Link to="/" className="book-tabs-back" title="返回书架">
        <span className="msr msr-sm">arrow_back</span> 书架
      </Link>
      <span className="book-tabs-divider" />
      {tabs.map((t) => (
        <Link key={t.key} to={t.to} className={`book-tab ${active === t.key ? 'active' : ''}`} role="tab" aria-selected={active === t.key}>
          <span className="msr msr-sm">{t.icon}</span> {t.label}
        </Link>
      ))}
    </div>
  );
}
