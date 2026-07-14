import React from 'react';

export function Logo() {
  return (
    <div className="brand-logo">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 28C6 24.6863 8.68629 22 12 22H26V28H12C10.8954 28 10 27.1046 10 26C10 24.8954 10.8954 24 12 24H24" stroke="url(#logo-grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 4H26V22H12C8.68629 22 6 19.3137 6 16V8C6 5.79086 7.79086 4 10 4Z" fill="url(#logo-bg-grad)" stroke="url(#logo-grad)" strokeWidth="2.5" strokeLinejoin="round"/>
        <path d="M11 9H21" stroke="var(--logo-lines)" strokeWidth="2" strokeLinecap="round"/>
        <path d="M11 13H17" stroke="var(--logo-lines)" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="21" cy="15" r="2" fill="#10b981" />
        <defs>
          <linearGradient id="logo-grad" x1="6" y1="4" x2="26" y2="28" gradientUnits="userSpaceOnUse">
            <stop stopColor="#818cf8"/>
            <stop offset="1" stopColor="#c084fc"/>
          </linearGradient>
          <linearGradient id="logo-bg-grad" x1="6" y1="4" x2="26" y2="22" gradientUnits="userSpaceOnUse">
            <stop stopColor="#312e81" stopOpacity="0.4"/>
            <stop offset="1" stopColor="#1e1b4b" stopOpacity="0.8"/>
          </linearGradient>
        </defs>
      </svg>
      <span className="brand-name">Novel<span className="accent">Eval</span></span>
    </div>
  );
}
