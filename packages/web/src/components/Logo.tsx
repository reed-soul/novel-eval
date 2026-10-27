import React from 'react';

export function Logo() {
  return (
    <div className="brand-logo" title="叙事工坊 Novel Studio">
      <div className="brand-icon-wrapper">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M8 7h8M8 11h5" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
      <div className="brand-text-group">
        <span className="brand-name">叙事工坊 <span className="brand-edition">Pro</span></span>
        <span className="brand-subline">AI 原生长篇创研套件</span>
      </div>
    </div>
  );
}
