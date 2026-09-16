/**
 * S5 配图：角色定妆照册（文生图）→ 分镜图（参考图图生图，角色一致性）。
 * 实测依据（M0 spike）：ark plan 端点 /api/plan/v3/images/generations，
 * doubao-seedream-5.0-lite，image:[url] 数组传参考图 HTTP 200。
 * 工程评审 P0 落地：参考图 SHA-256 级联进缓存键；approved 门禁批量分镜。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { NarrationScript } from '@novel-eval/shared';

const MODEL = 'doubao-seedream-5.0-lite';
const ENDPOINT = 'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations';
const SIZE = '2560x1440';
const SHEET_SIZE = '2048x2048';
const THROTTLE_MS = 12_000;      // 记忆教训：批量生图必须间隔
const CONCURRENCY = 2;           // 工程评审：2 路微并发 + 指数退避
/** 与 audiobook 场景图同源的悬疑底版风格（一套视觉资产两用） */
const STYLE_SUFFIX = ', dark suspenseful cinematic lighting, muted cold color palette, film grain, photorealistic, 16:9 anamorphic, high detail, no text, no watermark';

function arkKey(): string {
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY;
  return readFileSync(join(homedir(), '.zcode/ark-key.txt'), 'utf8').trim();
}

async function genImage(args: { prompt: string; refBase64?: string[]; size: string }, tag: string): Promise<Buffer> {
  const body: Record<string, unknown> = {
    model: MODEL, prompt: args.prompt + STYLE_SUFFIX, size: args.size, response_format: 'url',
  };
  if (args.refBase64?.length) body.image = args.refBase64;
  let delay = 5_000;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${arkKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      if (res.status >= 500 || res.status === 429) {
        console.warn(`  [${tag}] HTTP ${res.status}，${delay / 1000}s 后重试`);
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      throw new Error(`[${tag}] 生图失败 HTTP ${res.status}：${t.slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
    const item = json.data?.[0] ?? {};
    if (item.b64_json) return Buffer.from(item.b64_json, 'base64');
    if (item.url) return Buffer.from(await (await fetch(item.url)).arrayBuffer());
    throw new Error(`[${tag}] 返回无图：${JSON.stringify(json).slice(0, 300)}`);
  }
  throw new Error(`[${tag}] 3 次退避后仍失败`);
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 12);

/** 定妆照：每角色一张三视角中性底图；产物 characters/<id>.jpg + 状态回写 script.json。
 *  返回本次真实生成张数（缓存命中不计——成本台账只记新花费）。 */
export async function generateCharacterSheets(script: NarrationScript, outDir: string): Promise<number> {
  const sheetDir = join(outDir, 'characters');
  mkdirSync(sheetDir, { recursive: true });
  let generated = 0;
  for (const c of script.characters) {
    const file = join(sheetDir, `${c.id}.jpg`);
    if (existsSync(file) && statSync(file).size > 200_000) {
      c.sheetFile = `characters/${c.id}.jpg`;
      console.log(`  ✓ ${c.name} 定妆照已有`);
      continue;
    }
    console.log(`  ▸ 生成定妆照：${c.name}…`);
    const prompt = `Character design sheet, front and three-quarter view portrait, ${c.promptDesc}, neutral light grey studio background, photorealistic, high detail face and outfit`;
    const buf = await genImage({ prompt, size: SHEET_SIZE }, `sheet:${c.name}`);
    writeFileSync(file, buf);
    c.sheetFile = `characters/${c.id}.jpg`;
    generated += 1;
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }
  writeFileSync(join(outDir, 'script.json'), JSON.stringify(script, null, 2));
  return generated;
}

/** 分镜图：参考图=当帧出场角色的定妆照；缓存键含参考图内容哈希（级联失效） */
export async function generateSceneImages(script: NarrationScript, outDir: string): Promise<{ ok: number; fallback: string[] }> {
  // approved 门：有出场角色但未 approved → 拒绝批量（防半成品定妆照污染全书）
  const unapproved = script.characters.filter((c) => c.status !== 'approved' && c.sheetFile);
  if (unapproved.length) {
    throw new Error(`定妆照未批准：${unapproved.map((c) => c.name).join('、')}（先 sheets --approve，或 --approve 一起跑）`);
  }
  const sceneDir = join(outDir, 'scenes');
  mkdirSync(sceneDir, { recursive: true });
  const sheetCache = new Map<string, Buffer>();
  const loadSheet = (rel: string): Buffer => {
    if (!sheetCache.has(rel)) sheetCache.set(rel, readFileSync(join(outDir, rel)));
    return sheetCache.get(rel)!;
  };

  const jobs: Array<{ id: string; prompt: string; refs: string[]; file: string; cacheKey: string; marker: string }> = [];
  for (const q of script.sequences) {
    for (const b of q.beats) {
      const file = join(sceneDir, `${b.id}.jpg`);
      const marker = join(sceneDir, `.${b.id}.key`);
      const refs = b.visual.characterIds
        .map((cid) => script.characters.find((c) => c.id === cid)?.sheetFile)
        .filter((r): r is string => !!r);
      const refHashes = refs.map((r) => sha256(loadSheet(r)));
      const cacheKey = createHash('sha256').update(b.visual.prompt + '|' + refHashes.join(',')).digest('hex').slice(0, 16);
      if (existsSync(file) && existsSync(marker) && readFileSync(marker, 'utf-8').trim() === cacheKey) continue;
      jobs.push({ id: b.id, prompt: b.visual.prompt, refs, file, cacheKey, marker });
    }
  }
  console.log(`  待生成 ${jobs.length} 张分镜（${CONCURRENCY} 路并发，间隔 ${THROTTLE_MS / 1000}s）`);
  const fallback: string[] = [];
  let done = 0;
  const queue = [...jobs];
  const worker = async (): Promise<void> => {
    while (queue.length) {
      const job = queue.shift()!;
      try {
        const refs64 = job.refs.map((r) => `data:image/jpeg;base64,${loadSheet(r).toString('base64')}`);
        const buf = await genImage({ prompt: job.prompt, refBase64: refs64, size: SIZE }, `scene:${job.id}`);
        writeFileSync(job.file, buf);
        writeFileSync(job.marker, job.cacheKey);   // 级联缓存标记：prompt 或参考图变 → key 变 → 重生成
        done++;
        console.log(`  [${done}/${jobs.length}] ${job.id} ✓`);
      } catch (e) {
        fallback.push(job.id);
        console.warn(`  ✗ ${job.id} fallback：${(e as Error).message.slice(0, 120)}`);
      }
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { ok: jobs.length - fallback.length, fallback };
}
