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
  const detected = chardet.detect(buffer) ?? 'utf-8';
  let text: string;
  let encoding = detected;
  try {
    text = iconv.decode(buffer, detected);
  } catch {
    // chardet 偶尔误检（如 GBK 被判为 ISO-8859 之类），回退 GB18030（GBK 超集，覆盖中文）
    encoding = 'gb18030';
    text = iconv.decode(buffer, encoding);
  }
  // 去 BOM
  const cleaned = text.replace(/^\uFEFF/, '');
  return { text: cleaned, encoding };
}
