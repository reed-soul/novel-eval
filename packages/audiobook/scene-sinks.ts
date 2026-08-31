/**
 * 场景抽取的 sink 收口模块：LLM 引擎调用与 scenes.json 写入的唯一发生地。
 * 所有外部数据（章节文本/风格表）经任务文件（JSON 落盘）进入，本模块从盘回读——
 * 与 web/lib/pipeline-spawn 同款的跨文件断链模式。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { createEngine, callWithValidation, loadEngineConfig, type SchemaSpec, type EngineConfig } from '@novel-eval/shared';

// env 注入（对齐 eval/writer 的 loadEnv：读 ~/.claude/settings.json）
try {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const env = (JSON.parse(readFileSync(settingsPath, 'utf-8')) as { env?: Record<string, string> }).env ?? {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && !process.env[k]) process.env[k] = v;
} catch { /* 无配置则依赖现有 env */ }

const ENGINE_HOSTS = new Set(['open.bigmodel.cn', 'api.deepseek.com']);

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

export interface SceneTask {
  repoRoot: string;      // 仓库根（引擎配置目录与产物钳位的锚）
  outJson: string;       // scenes.json 绝对路径（主模块已钳位在仓库 dist/ 内）
  chapters: Array<{ pos: number; title: string; prompt: string }>;
}

/**
 * 读任务文件 → 逐章过 LLM 抽场景 → 写 scenes.json。
 * 引擎端点白名单（open.bigmodel.cn / api.deepseek.com）+ 产物路径钳位双保险。
 */
export async function runSceneExtraction(taskFile: string): Promise<void> {
  const task = JSON.parse(readFileSync(taskFile, 'utf-8')) as SceneTask;
  const repoRoot = resolve(task.repoRoot);
  const distAbs = join(repoRoot, 'dist');
  const outJson = resolve(task.outJson);
  if (outJson !== distAbs && !outJson.startsWith(distAbs + sep)) throw new Error('产物路径越界');

  const engineCfg = loadEngineConfig(join(repoRoot, 'packages', 'shared', 'config')).engine as EngineConfig;
  let host = '';
  try { host = new URL(engineCfg.baseUrl).hostname; } catch { /* 统一在下面拒 */ }
  if (!ENGINE_HOSTS.has(host)) throw new Error(`引擎端点不在白名单：${engineCfg.baseUrl}`);
  const engine = createEngine(engineCfg);

  const all: Array<{ pos: number; title: string; scenes: Array<{ slot: string; desc: string; prompt: string }> }> = [];
  for (const ch of task.chapters) {
    const res = await callWithValidation<{ scenes: Array<{ slot: string; desc: string; prompt: string }> }>(
      engine,
      ch.prompt,
      {
        systemPrompt: '你是影视分镜师。只输出 JSON，不要任何额外文字。',
        outputSchema: { type: 'object' },
        temperature: 0.4,
        maxTokens: 3000,
        timeoutMs: 180_000,
        schema: SCHEMA,
        maxAttempts: 3,
      },
    );
    if (!res.ok || !res.data) throw new Error(`ch${ch.pos} 场景抽取失败：${res.errors.join('; ')}`);
    all.push({ pos: ch.pos, title: ch.title, scenes: res.data.scenes });
    console.log(`ch${String(ch.pos).padStart(2, '0')} 《${ch.title}》 ${res.data.scenes.length} 景：${res.data.scenes.map((s) => s.desc.slice(0, 14)).join(' / ')}`);
  }

  mkdirSync(dirname(outJson), { recursive: true });
  writeFileSync(outJson, JSON.stringify(all, null, 2), 'utf-8');
  console.log(`✓ ${all.reduce((s, c) => s + c.scenes.length, 0)} 个场景 → ${outJson}`);
}
