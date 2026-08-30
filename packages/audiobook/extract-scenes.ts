/**
 * 场景抽取（2026-08-28，一次性脚本）：15 章正文 → 每章 3-5 个剧情场景 + 生图 prompt。
 * 文本模型走本地 GLM（~/.claude/settings.json 的 env），无 ARK 依赖。
 * 输出 dist/audiobook-v3/scenes.json，供 Gemini 生图循环消费（NN-a/b/c.jpg）。
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { openWriterDb, resolveProjectId, loadChapters } from './src/db.ts';
import { createEngine, callWithValidation, loadEngineConfig, type SchemaSpec } from '../shared/src/index.ts';

// env 注入（对齐 eval/writer 的 loadEnv：读 ~/.claude/settings.json）
try {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const env = (JSON.parse(readFileSync(settingsPath, 'utf-8')) as { env?: Record<string, string> }).env ?? {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && !process.env[k]) process.env[k] = v;
} catch { /* 无配置则依赖现有 env */ }

const REPO_ROOT = process.cwd();
const OUT = resolve(REPO_ROOT, 'dist/audiobook-v3/scenes.json');

const STYLE = `Unified visual style for all scenes: cinematic photographic realism, Northeast China (黑龙江小兴安岭) winter, cold blue-grey palette with exactly one warm light source (lantern / locomotive headlight / furnace glow / desk lamp), falling or fallen snow, 1990s or 2010 period texture, film grain, muted colors, wide 16:9 cinematic composition, moody suspense atmosphere like the TV series "The Long Season". ABSOLUTELY NO text, letters, numbers, captions or watermarks in the image.`;

const CHARACTERS = `Character sheet (keep consistent across scenes when present):
- SU YE (苏野, 2010 timeline): Chinese female investigative journalist, early 30s, dark wool coat, scarf, calm sharp gaze.
- SU WENYUAN (苏文远, 1998 timeline): thin middle-aged accountant, slightly stooped, faded blue-grey padded cotton coat, cloth cap, abacus and fountain pen, gentle weary face.
- ZHAO YOUCAI (赵有财): greasy mid-aged thug boss in black leather jacket, blunt face.
- ZHOU YUXUAN (周宇轩, 2010): 40-year-old official, short hair, dark navy jacket, cold official demeanor.
- WANG SHUFEN (王淑芬): dying elderly hospital patient woman.
- Old railway station: red-brick waiting hall, soot-blackened fire wall with a crack, iron stove, dim tungsten bulb.
- Forest railway: narrow-gauge steam locomotive, snow-covered tracks, birch forest line.`;

const SCHEMA: SchemaSpec = {
  scenes: {
    type: 'array', min: 3, max: 5, required: true,
    itemSpec: {
      type: 'object', fields: {
        slot: { type: 'string', required: true },
        desc: { type: 'string', min: 6, max: 80, required: true },
        prompt: { type: 'string', min: 60, max: 900, required: true },
      },
    },
  },
};

const SYSTEM = '你是影视分镜师。只输出 JSON，不要任何额外文字。';

function chapterPrompt(title: string, content: string): string {
  return `把这一章悬疑小说拆成 3-5 个「分镜级场景」，用于给有声书视频配插图。

要求：
- 场景按剧情顺序，各是不同的地点/动作/时刻（不要同构图变体）
- desc=中文一句话场景说明；prompt=英文生图提示词（具体到地点、人物、光线、动作、镜头）
- prompt 里人物用 Character sheet 的英文描述，保持全书一致
- 优先选：有视觉冲击的（火墙/白骨/雪夜火车/暗房红灯/病房/焚烧档案）、有情绪的、推进剧情的关键场景
- slot 依次为 "a","b","c","d","e"

${CHARACTERS}

${STYLE}
（风格与人物表已拼进每条 prompt 结尾，无需重复）

## 章节标题
${title}

## 章节正文（截断）
${content.slice(0, 9000)}

只输出 JSON：{"scenes":[{"slot":"a","desc":"…","prompt":"…"}]}`;
}

async function main() {
  const db = openWriterDb(resolve(REPO_ROOT, 'data/writer/writer.db'));
  const projectId = resolveProjectId(db, '最后一班森铁');
  const chapters = loadChapters(db, projectId, '1-15');
  console.log(`章节 ${chapters.length} 个`);

  const { engine } = loadEngineConfig(resolve(REPO_ROOT, 'packages/shared/config'));
  const engine2 = createEngine(engine);
  const all: Array<{ pos: number; title: string; scenes: Array<{ slot: string; desc: string; prompt: string }> }> = [];

  for (const ch of chapters) {
    const res = await callWithValidation<{ scenes: Array<{ slot: string; desc: string; prompt: string }> }>(
      engine2,
      chapterPrompt(ch.title, ch.content),
      {
        systemPrompt: SYSTEM,
        outputSchema: { type: 'object' },
        temperature: 0.4,
        maxTokens: 3000,
        timeoutMs: 180_000,
        schema: SCHEMA,
        maxAttempts: 3,
      },
    );
    if (!res.ok || !res.data) {
      throw new Error(`ch${ch.position} 场景抽取失败：${res.errors.join('; ')}`);
    }
    const scenes = res.data.scenes.map((s) => ({
      slot: s.slot,
      desc: s.desc,
      prompt: `${s.prompt} ${STYLE}`,
    }));
    all.push({ pos: ch.position, title: ch.title, scenes });
    console.log(`ch${String(ch.position).padStart(2, '0')} 《${ch.title}》 ${scenes.length} 景：${scenes.map((s) => s.desc.slice(0, 14)).join(' / ')}`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(all, null, 2), 'utf-8');
  const total = all.reduce((s, c) => s + c.scenes.length, 0);
  console.log(`✓ ${total} 个场景 → ${OUT}`);
}

main().catch((e) => { console.error('失败:', (e as Error).message); process.exit(1); });
