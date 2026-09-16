/**
 * Seedream 参考图（角色一致性）能力 spike —— 2026-09-16
 * 目的：验证 plan 端点 /api/plan/v3/images/generations 是否支持参考图参数（image），
 *       以及参数形态（数组 vs 字符串）与 base64/url 皆可。
 * 配额保守：最多 3 次生图（1 张定妆照 + 2 次参考图尝试）。
 * 产物落 research/narration-video/spike/
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const KEY = readFileSync(`${process.env.HOME}/.zcode/ark-key.txt`, 'utf8').trim();
const ENDPOINT = 'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations';
const MODEL = 'doubao-seedream-5.0-lite';
const OUT = new URL('./spike/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

async function gen(body, tag) {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`[${tag}] HTTP ${res.status} in ${Date.now() - t0}ms`);
  if (!res.ok) {
    console.log(`[${tag}] ERROR BODY: ${text.slice(0, 600)}`);
    return null;
  }
  let json;
  try { json = JSON.parse(text); } catch { console.log(`[${tag}] non-JSON: ${text.slice(0, 300)}`); return null; }
  // 兼容 data[0].url / b64_json 两种返回
  const item = json?.data?.[0] ?? {};
  const url = item.url;
  if (url) {
    const img = await (await fetch(url)).arrayBuffer();
    const file = `${OUT}${tag}.jpg`;
    writeFileSync(file, Buffer.from(img));
    console.log(`[${tag}] saved ${file} (${img.byteLength} bytes)`);
    return { url, file };
  }
  if (item.b64_json) {
    const file = `${OUT}${tag}.jpg`;
    writeFileSync(file, Buffer.from(item.b64_json, 'base64'));
    console.log(`[${tag}] saved b64 ${file}`);
    return { url: null, file };
  }
  console.log(`[${tag}] unexpected shape: ${JSON.stringify(json).slice(0, 400)}`);
  return null;
}

// ── 第 1 步：文生图「角色定妆照」 ──
const sheetPrompt = 'Character design sheet, three-quarter view portrait of a 62-year-old Chinese woman, short grey hair with a hairpin, warm face wrinkles, wearing a dark red wool jacket, calm wise smile, neutral light grey background, photorealistic, cinematic lighting, high detail';
console.log('== STEP 1: text-to-image character sheet ==');
const sheet = await gen(
  { model: MODEL, prompt: sheetPrompt, size: '2048x2048', response_format: 'url' },
  '01-sheet',
);
if (!sheet?.url) {
  console.log('STEP1 failed, abort.');
  process.exit(1);
}

// ── 第 2 步：参考图图生图（形态 A：image 为 URL 数组） ──
console.log('== STEP 2A: reference image as array of URL ==');
const refPrompt = 'The SAME 62-year-old Chinese woman from the reference image (identical face, identical short grey hair with hairpin, identical dark red wool jacket), standing in an old Chinese kitchen at night, sewing on a black vintage Butterfly brand sewing machine by warm lamp light, photorealistic, cinematic, high detail';
const a = await gen(
  { model: MODEL, prompt: refPrompt, image: [sheet.url], size: '2560x1440', response_format: 'url' },
  '02-ref-array-url',
);

// ── 第 3 步（仅当 A 失败）：形态 B：image 为 base64 数组 ──
if (!a) {
  console.log('== STEP 2B: reference image as array of base64 ==');
  const b64 = readFileSync(sheet.file).toString('base64');
  await gen(
    { model: MODEL, prompt: refPrompt, image: [`data:image/jpeg;base64,${b64}`], size: '2560x1440', response_format: 'url' },
    '02-ref-array-b64',
  );
}

console.log('== SPIKE DONE ==');
