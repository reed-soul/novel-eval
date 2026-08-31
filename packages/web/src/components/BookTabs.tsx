/**
 * 书工作台 Tab 条：写作 | 有声书（| 质检 M1）——书内唯一层级导航。
 * 从 /books/:id 下任意子页都能一步切形态。
 */
import React from 'react';
import { Link, useParams } from 'react-router-dom';

export function BookTabs({ active }: { active: 'writing' | 'audiobook' }) {
  const { id = '' } = useParams();
  const tabs: { key: 'writing' | 'audiobook'; to: string; label: string; icon: string }[] = [
    { key: 'writing', to: `/books/${id}`, label: '写作', icon: 'edit_note' },
    { key: 'audiobook', to: `/books/${id}/audiobook`, label: '有声书', icon: 'graphic_eq' },
  ];
  return (
    <div className="book-tabs" role="tablist">
      <Link to="/" className="book-tabs-back">
        <span className="msr msr-sm">chevron_left</span> 我的书
      </Link>
      <span className="book-tabs-divider" />
      {tabs.map((t) => (
        <Link key={t.key} to={t.to} className={`book-tab ${active === t.key ? 'active' : ''}`} role="tab" aria-selected={active === t.key}>
          <span className="msr msr-sm">{t.icon}</span> {t.label}
        </Link>
      ))}
      <span className="book-tab book-tab-coming" title="2.0 M1 开放">质检</span>
    </div>
  );
}
