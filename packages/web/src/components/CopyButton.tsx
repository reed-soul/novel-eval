import React, { useState } from 'react';

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  title?: string;
}

export function CopyButton({
  text,
  label = '复制',
  copiedLabel = '✓ 已复制',
  className = 'pub-copy-btn',
  title = '复制到剪贴板',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 兼容非安全上下文回退
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      type="button"
      className={`${className} ${copied ? 'copied' : ''}`}
      onClick={handleCopy}
      title={title}
    >
      <span className="msr msr-sm">{copied ? 'check' : 'content_copy'}</span>
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}
