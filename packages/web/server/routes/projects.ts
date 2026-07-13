/** 项目路由 — GET 列表 / GET 详情 / GET 导出 */
import { Hono } from 'hono';
import JSZip from 'jszip';
import {
  listProjects,
  getProject,
  countOutlines,
  countChapters,
  getChapter,
  getAllOutlines,
  type DB,
} from '@novel-eval/writer';

export function projectRoutes(db: DB) {
  const app = new Hono();

  // 项目列表
  app.get('/', (c) => {
    const projects = listProjects(db);
    return c.json(projects);
  });

  // 导出小说
  app.get('/:id/export', async (c) => {
    const id = c.req.param('id');
    const format = c.req.query('format') || 'merge-txt'; // merge-txt | merge-md | zip-txt
    const includeMeta = c.req.query('includeMeta') === 'true';

    const project = getProject(db, id);
    if (!project) return c.json({ error: '项目不存在' }, 404);

    const outlines = getAllOutlines(db, id);
    const chapters: { number: number; title: string; content: string; outlineSummary?: string }[] = [];

    for (const o of outlines) {
      const ch = getChapter(db, id, o.number);
      if (ch) {
        chapters.push({
          number: o.number,
          title: ch.title || o.title || `第 ${o.number} 章`,
          content: ch.content,
          outlineSummary: o.summary,
        });
      }
    }

    if (chapters.length === 0) {
      return c.json({ error: '该项目尚未生成任何章节内容' }, 400);
    }

    chapters.sort((a, b) => a.number - b.number);

    if (format === 'zip-txt') {
      const zip = new JSZip();
      for (const ch of chapters) {
        let fileContent = '';
        if (includeMeta && ch.outlineSummary) {
          fileContent += `大纲：${ch.outlineSummary}\n\n`;
        }
        fileContent += ch.content;
        const numStr = String(ch.number).padStart(3, '0');
        // 清理文件名非法字符
        const safeTitle = ch.title.replace(/[\/\\?%*:|"<>\s]/g, '_');
        const filename = `${numStr}_${safeTitle}.txt`;
        zip.file(filename, fileContent);
      }
      const archive = await zip.generateAsync({ type: 'uint8array' });
      c.header('Content-Type', 'application/zip');
      c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(project.title)}_chapters.zip"`);
      return c.body(archive as any);
    } else if (format === 'merge-md') {
      let md = `# ${project.title}\n\n`;
      for (const ch of chapters) {
        md += `## 第${ch.number}章 ${ch.title}\n\n`;
        if (includeMeta && ch.outlineSummary) {
          md += `> **本章大纲**：${ch.outlineSummary}\n\n`;
        }
        md += `${ch.content}\n\n\n`;
      }
      c.header('Content-Type', 'text/markdown; charset=utf-8');
      c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(project.title)}.md"`);
      return c.body(md);
    } else {
      // 默认 merge-txt
      let txt = `${project.title}\n\n`;
      for (const ch of chapters) {
        txt += `第${ch.number}章 ${ch.title}\n\n`;
        if (includeMeta && ch.outlineSummary) {
          txt += `【本章大纲：${ch.outlineSummary}】\n\n`;
        }
        txt += `${ch.content}\n\n\n`;
      }
      c.header('Content-Type', 'text/plain; charset=utf-8');
      c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(project.title)}.txt"`);
      return c.body(txt);
    }
  });

  // 项目详情（含进度统计）
  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const project = getProject(db, id);
    if (!project) return c.json({ error: '项目不存在' }, 404);
    const outlineCount = countOutlines(db, id);
    const chapterCount = countChapters(db, id);
    const lastChapter = chapterCount > 0 ? getChapter(db, id, chapterCount) : null;
    return c.json({
      ...project,
      outlineCount,
      chapterCount,
      lastChapter: lastChapter ? { number: lastChapter.number, title: lastChapter.title, wordCount: lastChapter.wordCount } : null,
    });
  });

  return app;
}
