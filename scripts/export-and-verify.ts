import sqlite3 from 'better-sqlite3';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const DB_PATH = resolve(process.cwd(), process.env.WRITER_DB_PATH || 'data/writer/writer.db');
const db = new sqlite3(DB_PATH);

const targetTitle = process.argv[2] || '我给母亲领靶向药，扫出十年前过世父亲的医保单';
const outputDir = process.argv[3] || 'research/daily-novels/2026-10-02-yaofang-yibaodan';

console.log(`=== 正在导出并自检: 《${targetTitle}》 ===`);

const project = db.prepare(`SELECT id, title, created_at, status FROM project WHERE title = ? ORDER BY created_at DESC LIMIT 1`).get(targetTitle) as { id: string; title: string; created_at: string; status: string } | undefined;

if (!project) {
  console.error(`未在数据库中找到项目: 《${targetTitle}》`);
  process.exit(1);
}

console.log(`项目 ID: ${project.id} | 状态: ${project.status}`);

interface ChapterRow {
  position: number;
  outline_title: string;
  revision_title: string;
  content: string;
  word_count: number;
}

const chapters = db.prepare(`
  SELECT 
    co.position,
    cor.title as outline_title,
    cr.title as revision_title,
    cr.content,
    cr.word_count
  FROM chapter c
  JOIN chapter_outline co ON c.outline_id = co.id
  LEFT JOIN chapter_outline_revision cor ON co.active_revision_id = cor.id
  JOIN chapter_revision cr ON c.active_revision_id = cr.id
  WHERE c.project_id = ?
  ORDER BY co.position ASC
`).all(project.id) as ChapterRow[];

console.log(`找到已完成章节数: ${chapters.length}`);

if (chapters.length === 0) {
  console.error('项目暂无已生成章节');
  process.exit(1);
}

// 拼书文本
const bookLines: string[] = [];
let totalChars = 0;

for (const ch of chapters) {
  const cleanTitle = (ch.revision_title || ch.outline_title || `第${ch.position}章`).replace(/^第\d+章\s*/, '').trim();
  const header = `# 第${ch.position}章 ${cleanTitle}`;
  bookLines.push(header);
  bookLines.push('');

  // 剥离 content 首行自带的标题层（如果有）
  let body = ch.content.trim();
  body = body.replace(/^#+\s*第\d+章[^\n]*\n+/g, '').trim();
  body = body.replace(/^第\d+章[^\n]*\n+/g, '').trim();

  // 检查是否包含脚手架泄漏（例如结尾的“待续路径提示”或大纲提示）
  const lines = body.split('\n');
  const cleanBodyLines: string[] = [];
  for (const line of lines) {
    if (line.includes('待续路径提示') || line.includes('【写作蓝图】') || line.includes('【大纲草稿】')) {
      console.warn(`[脚手架泄漏拦截] 第${ch.position}章跳过元数据行: ${line}`);
      continue;
    }
    cleanBodyLines.push(line);
  }

  const finalBody = cleanBodyLines.join('\n').trim();
  bookLines.push(finalBody);
  bookLines.push('');
  totalChars += [...finalBody].length;
}

const bookContent = bookLines.join('\n');
mkdirSync(outputDir, { recursive: true });
const bookPath = resolve(outputDir, 'book.md');
writeFileSync(bookPath, bookContent, 'utf-8');

console.log(`\n✅ 成功拼书并保存到: ${bookPath}`);
console.log(`总字数（正文字符数）: ${totalChars} 字 | 章节数: ${chapters.length} 章`);

// ── 严格自检 ──
console.log('\n--- 开始文本合规与质量自检 ---');

// 1. 英文残留扫描
const englishMatches = bookContent.match(/[A-Za-z]{2,}/g) || [];
if (englishMatches.length > 0) {
  console.warn(`⚠ 发现英文残留 (${englishMatches.length} 处):`, Array.from(new Set(englishMatches)).slice(0, 10));
} else {
  console.log(`✅ 纯中文零英文残留: 通过 (0 处英文字符串)`);
}

// 2. 偏好姓氏与禁名扫描
const blacklist = [
  '小满',
  '温以宁', '温以蘅', '温昭', '温若蘅',
  '纪桐', '孟叙白', '阚伯', '池羽', '路之衍', '贺明霜', '聂霜', '霍岑',
  '柯万山', '聂虹', '米露', '韩澈', '林嘉', '方砚', '祁烨', '陈晓蔓',
  '雷正坤', '周秀兰', '贺云笙', '盛清让', '齐慕荪', '贺照野', '周鹤年',
  '贺振农', '林欢桐', '麦冬', '陆沉', '程一格', '关雨眠', '沈淮安',
  '陆承泽', '宋文渊', '秦素', '何平', '赵立新', '陆岩', '陆天成',
  '童长海', '裴定安', '童舒', '苏晚潮', '贺一刀'
];

let blacklistHits = 0;
for (const name of blacklist) {
  const count = (bookContent.match(new RegExp(name, 'g')) || []).length;
  if (count > 0) {
    console.error(`❌ 撞车黑名单禁名: "${name}" 出现 ${count} 次`);
    blacklistHits++;
  }
}

// 检查温姓人名（排除温度/温控/温水/体温/温热/恒温等正常用词）
const wenNames = bookContent.match(/温[一-龥]{1,2}(?=[，。！？\s说走了道])/g) || [];
const safeWenWords = ['温度', '温控', '温水', '体温', '温热', '恒温', '温润', '温暖', '升温', '降温', '保鲜', '保温'];
const illegalWen = wenNames.filter(w => !safeWenWords.some(s => w.startsWith(s)));
if (illegalWen.length > 0) {
  console.error(`❌ 发现可能违禁的温姓人名:`, Array.from(new Set(illegalWen)));
  blacklistHits++;
}

if (blacklistHits === 0) {
  console.log(`✅ 人名合规自检通过: 无「小满」、无「温」姓角色、无近 10 部历史人物姓名碰撞`);
}

console.log('--- 自检完毕 ---\n');
