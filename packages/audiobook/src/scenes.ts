/**
 * 场景抽取备料（sink-free）：DB 章节 + per-book 风格/角色表 → 分镜 prompt 任务。
 * 引擎调用与产物写入在 scene-sinks.runSceneExtraction（跨文件收口）。
 */
import { join, resolve, dirname, sep } from 'node:path';
import { ProjectRepository, projectId as toProjectId, type DB } from '@novel-eval/writer';
import { openWriterDb, resolveProjectId, loadChapters } from './db.ts';
import { loadProjectConfig } from './project-config.ts';
import { loadRegistry, type BookRegistry } from './registry.ts';

const REPO_ROOT = process.cwd(); // 与 cli.ts 同款：经 pnpm audiobook 运行时 cwd=仓库根
const DIST_ABS = join(REPO_ROOT, 'dist');

export interface SceneTaskChapter {
  pos: number;
  title: string;
  prompt: string;
}

export interface SceneTask {
  repoRoot: string;
  outJson: string;
  chapters: SceneTaskChapter[];
}

/** 缺省风格（书未配置 sceneStyle 时的通用悬疑底版；配置则完全覆盖） */
const FALLBACK_STYLE = `Unified visual style for all scenes: cinematic photographic realism, moody suspense atmosphere, muted colors with one warm light source, film grain, wide 16:9 cinematic composition. ABSOLUTELY NO text, letters, numbers, captions or watermarks in the image.`;

function chapterPrompt(title: string, content: string, style: string, characters: string | undefined): string {
  return `把这一章悬疑小说拆成 3-5 个「分镜级场景」，用于给有声书视频配插图。

要求：
- 场景按剧情顺序，各是不同的地点/动作/时刻（不要同构图变体）
- desc=中文一句话场景说明；prompt=英文生图提示词（具体到地点、人物、光线、动作、镜头）
- prompt 里人物用 Character sheet 的英文描述，保持全书一致
- 优先选：有视觉冲击的、有情绪的、推进剧情的关键场景
- slot 依次为 "a","b","c","d","e"

${characters ?? '（本书无固定角色表：按正文描写生成人物外观，同章内保持一致）'}

${style}
（风格与人物表已拼进每条 prompt 结尾，无需重复）

## 章节标题
${title}

## 章节正文（截断）
${content.slice(0, 9000)}

只输出 JSON：{"scenes":[{"slot":"a","desc":"…","prompt":"…"}]}`;
}

/** 产物根钳位：registry 值解析后必须落在仓库 dist/ 内（登记文件可被手改，双保险） */
function slugDirOf(rec: BookRegistry): string {
  const dir = dirname(resolve(REPO_ROOT, rec.outRoot));
  if (dir !== DIST_ABS && !dir.startsWith(DIST_ABS + sep)) throw new Error(`registry outRoot 越界：${rec.outRoot}`);
  return dir;
}

/**
 * 备料：读 DB 章节 + registry/config → 完整抽取任务（含每章 prompt 与产物路径）。
 * 返回 { task, outJson 显示路径 }；不触网络不写文件。
 */
export function buildSceneTask(projectArg: string, chaptersArg?: string): { task: SceneTask; bookTitle: string } {
  const db = openWriterDb(join(REPO_ROOT, 'data/writer/writer.db'));
  const projectId = resolveProjectId(db, projectArg);
  const project = new ProjectRepository(db as unknown as DB).get(toProjectId(projectId));
  if (!project) throw new Error(`未找到项目：${projectId}`);
  const bookTitle = project.title;
  const chapters = loadChapters(db, projectId, chaptersArg);
  db.close();

  const rec = loadRegistry(join(REPO_ROOT, 'data/audiobook'))[projectId];
  if (!rec) throw new Error('该书尚未建线（先在 Web 有声书 tab 开启，或手动写 data/audiobook/registry.json）');
  const { config } = loadProjectConfig({ dataDir: join(REPO_ROOT, 'data/audiobook'), projectId, title: bookTitle });
  const style = config.sceneStyle ?? FALLBACK_STYLE;
  const characters = config.sceneCharacters;

  return {
    task: {
      repoRoot: REPO_ROOT,
      outJson: join(slugDirOf(rec), 'scenes.json'), // dist/derivatives/<slug>/scenes.json
      chapters: chapters.map((ch) => ({
        pos: ch.position,
        title: ch.title,
        prompt: chapterPrompt(ch.title, ch.content, style, characters),
      })),
    },
    bookTitle,
  };
}
