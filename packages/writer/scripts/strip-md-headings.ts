/**
 * 清洗精修引入的 markdown 标题污染。
 * 只去掉章节正文「开头连续的」标题行（# 第X章 / ## 第X次输出 / **第X章**），
 * 不碰正文内的 #（代码块、注释等）。
 */
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { getChapter, saveChapter } from '../src/chapter/store.ts';
import { openDb, closeDb } from '../src/db.ts';

const PID = '790d8aaf-6278-475e-a270-fddc91c89250';

/** 去掉 content 开头连续的标题/元信息行，返回清洗后的 content */
function stripHeading(content: string, chapterNum: number): { cleaned: string; changed: boolean } {
  const lines = content.split('\n');
  let i = 0;
  // 跳过开头的：空行、markdown标题(#/##)、加粗标题(**第X章**)、"第X次输出"行、重复的"第X章 标题"行
  const numCN = ['零','一','二','三','四','五','六','七','八','九','十'];
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '') { i++; continue; }
    // markdown 标题
    if (/^#{1,6}\s/.test(line)) { i++; continue; }
    // "第X次输出" 或 "# 第X次输出" 已被上面处理，这里抓 "第九十五次输出" 这类
    if (/^第[一二三四五六七八九十百零0-9]+次输出$/.test(line)) { i++; continue; }
    // 加粗的章节标题 **第X章** 或 **第X章 标题**
    if (/^\*\*第.{1,6}章/.test(line)) { i++; continue; }
    // 重复的纯标题行 "第X章 标题"（与 DB title 重复）
    break;
  }
  // 如果前面跳过了标题行，从第一个非标题行开始
  if (i > 0) {
    const cleaned = lines.slice(i).join('\n').replace(/^\n+/, '');
    return { cleaned, changed: cleaned !== content };
  }
  return { cleaned: content, changed: false };
}

const db = openDb();
try {
  const total = 110;
  let cleaned = 0;
  for (let num = 1; num <= total; num++) {
    const ch = getChapter(db, PID, num);
    if (!ch) continue;
    const { cleaned: text, changed } = stripHeading(ch.content, num);
    if (changed) {
      saveChapter(db, PID, num, { title: ch.title, content: text, wordCount: text.length });
      cleaned++;
    }
  }
  console.log(`✓ 清洗完成：${cleaned} 章去除了 markdown 标题污染`);
} finally {
  closeDb(db);
}
