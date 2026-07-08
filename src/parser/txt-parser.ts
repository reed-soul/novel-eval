/**
 * TXT 文档解析（对齐设计文档 v2.2 第五章）
 *
 * MVP 仅实现 TXT：自动检测编码（GBK/UTF-8 等）→ 转 UTF-8 纯文本。
 * EPUB/PDF/DOCX 留待 v2。
 */
import { readFileSync } from 'node:fs';
import chardet from 'chardet';
import iconv from 'iconv-lite';

export interface ParsedDocument {
  title?: string;
  author?: string;
  text: string;
  encoding: string;
}

export function parseTxt(filePath: string): ParsedDocument {
  const buffer = readFileSync(filePath);
  const encoding = chardet.detect(buffer) ?? 'utf-8';
  const text = iconv.decode(buffer, encoding);
  // 去 BOM
  const cleaned = text.replace(/^\uFEFF/, '');
  return { text: cleaned, encoding };
}
