/**
 * S3 双门：结构门（程序化，零成本）+ 因果稽核门（LLM 对照 P1 事实表）。
 * 工程评审 P1：因果门严禁全文硬比——以 P1 章节事实表为基准，豁免叙事顺序重排。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEngine, loadEngineConfig, callWithValidation,
  type SchemaSpec, type NarrationScript, type StructureGateReport, type CausalGateReport,
  flattenBeats, flattenSentences, scriptTotalChars,
} from '@novel-eval/shared';
import { NEGATIVE_LEXICON, causalProbePrompt } from './prompts.ts';
import { CHARS_PER_SEC } from './script.ts';

const FACE_RATIO_MAX = 0.15;
const MAX_STRETCH_WITHOUT_TURN_S = 180; // 3 分钟无 turn/peak 即中段塌陷（4–6 分钟解谜闭环约束）
const DURATION_TOLERANCE = 0.15;

/** 结构门：节奏/禁词/句长/正脸配额/首尾形态，全部程序化检查 */
export function structureGate(script: NarrationScript, targetMinutes: number): StructureGateReport {
  const issues: string[] = [];
  const beats = flattenBeats(script);
  const sentences = flattenSentences(script);
  const totalChars = scriptTotalChars(script);
  const estimatedMinutes = totalChars / CHARS_PER_SEC / 60;

  // 1. 首 beat 必须 hook（In Media Res 履约）
  const hookInFirst = beats[0]?.kind === 'hook';
  if (!hookInFirst) issues.push('首拍不是 hook：冷开场缺失（物证落差法）');

  // 2. 尾拍必须 close/coda 收束，且 coda 是最后一拍
  const last = beats[beats.length - 1];
  if (last && last.kind !== 'coda' && last.kind !== 'close') {
    issues.push(`末拍 ${last.id} 是 ${last.kind}：结尾未按 close/coda 余音收束`);
  }
  const codaCount = beats.filter((b) => b.kind === 'coda').length;
  if (codaCount > 1) issues.push(`出现 ${codaCount} 个 coda（只允许 1 个）`);

  // 3. 负向词库（内容评审规范 2）
  for (const s of sentences) {
    for (const w of NEGATIVE_LEXICON) {
      if (s.text.includes(w)) issues.push(`负向词「${w}」@ ${s.id}：${s.text.slice(0, 24)}…`);
    }
  }

  // 4. 句长（规范 5：字幕单元 15–30 字，高潮 8–14 也合法；>42 必炸字幕）
  const tooLong = sentences.filter((s) => s.text.length > 42);
  for (const s of tooLong.slice(0, 5)) issues.push(`句超长 ${s.text.length} 字 @ ${s.id}`);

  // 5. 正脸配额（规范 7）
  const faceCount = beats.filter((b) => b.visual.shot === 'face').length;
  const faceShotRatio = beats.length ? faceCount / beats.length : 0;
  if (faceShotRatio > FACE_RATIO_MAX) issues.push(`正脸分镜占比 ${(faceShotRatio * 100).toFixed(0)}% > ${FACE_RATIO_MAX * 100}%`);

  // 6. 中段塌陷：无 turn/peak 的最长预估时长
  let longestStretchWithoutTurnS = 0, accChars = 0;
  for (const b of beats) {
    accChars += b.sentences.reduce((n, s) => n + s.text.length, 0);
    if (b.kind === 'turn' || b.kind === 'peak' || b.kind === 'hook' || b.kind === 'close') {
      longestStretchWithoutTurnS = Math.max(longestStretchWithoutTurnS, accChars / CHARS_PER_SEC);
      accChars = 0;
    }
  }
  longestStretchWithoutTurnS = Math.max(longestStretchWithoutTurnS, accChars / CHARS_PER_SEC);
  if (beats.length > 4 && longestStretchWithoutTurnS > MAX_STRETCH_WITHOUT_TURN_S) {
    issues.push(`最长无转折段 ${Math.round(longestStretchWithoutTurnS)}s > ${MAX_STRETCH_WITHOUT_TURN_S}s：中段塌陷`);
  }

  // 7. 时长命中
  if (targetMinutes > 0) {
    const drift = Math.abs(estimatedMinutes - targetMinutes) / targetMinutes;
    if (drift > DURATION_TOLERANCE) {
      issues.push(`预估时长 ${estimatedMinutes.toFixed(1)} 分钟偏离目标 ${targetMinutes} 分钟 ${Math.round(drift * 100)}%（容忍 ±${DURATION_TOLERANCE * 100}%）`);
    }
  }

  // 8. beat 空句 / 角色引用有效性
  const charIds = new Set(script.characters.map((c) => c.id));
  for (const b of beats) {
    if (b.sentences.length === 0) issues.push(`beat ${b.id} 无口播句`);
    for (const cid of b.visual.characterIds) if (!charIds.has(cid)) issues.push(`beat ${b.id} 引用未注册角色 ${cid}`);
  }

  return {
    passed: issues.length === 0,
    totalChars, estimatedMinutes: Number(estimatedMinutes.toFixed(1)), issues,
    stats: {
      beats: beats.length, hookInFirst,
      peakCount: beats.filter((b) => b.kind === 'peak').length,
      longestStretchWithoutTurnS: Math.round(longestStretchWithoutTurnS),
      faceShotRatio: Number(faceShotRatio.toFixed(3)),
    },
  };
}

interface MapsFacts {
  facts: Array<{ ch: number; subject: string; action: string; object: string }>;
  moralityLocks: Array<{ name: string; lock: string }>;
}

/** 因果稽核门（LLM）：因果倒置 + 人设变形 */
export async function causalGate(
  script: NarrationScript, mapsFactsFile: string, repoRoot: string,
): Promise<CausalGateReport> {
  const facts: MapsFacts = JSON.parse(readFileSync(mapsFactsFile, 'utf-8'));
  const narrationText = flattenBeats(script)
    .map((b) => `[${b.id}] ${b.sentences.map((s) => s.text).join('')}`)
    .join('\n');

  const cfg = loadEngineConfig(join(repoRoot, 'packages/shared/config'));
  const engine = createEngine(cfg.engine);
  const schema: SchemaSpec = {
    passed: { type: 'boolean' },
    violations: { type: 'array', required: true, itemSpec: { type: 'object', fields: {
      beatId: { type: 'string', required: true },
      claim: { type: 'string', min: 4, max: 200, required: true },
      problem: { type: 'string', min: 8, max: 300, required: true },
    } } },
  };
  const res = await callWithValidation<{ passed: boolean; violations: Array<{ beatId: string; claim: string; problem: string }> }>(
    engine,
    causalProbePrompt(
      narrationText,
      JSON.stringify(facts.facts),
      JSON.stringify(facts.moralityLocks),
    ),
    { schema, maxAttempts: 3, disableThinking: true, maxTokens: 4000, timeoutMs: 300_000,
      systemPrompt: '你是严谨的事实稽核员。只输出 JSON。' },
  );
  if (!res.ok || res.data === null) {
    return { passed: false, triplesChecked: 0, violations: [{ beatId: '-', claim: '稽核调用失败', problem: res.errors.join('; ') }] };
  }
  return { passed: res.data.passed, triplesChecked: facts.facts.length, violations: res.data.violations ?? [] };
}
