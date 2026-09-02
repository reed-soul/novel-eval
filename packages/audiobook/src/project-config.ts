/**
 * 有声书 per-project 配置：发音表（pron）+ 角色音色（voiceBySpeaker）。
 * 行业对应物：欧美 prep 的 pronunciation guide / character sheet，中文画本的角色标注。
 *
 * 发现顺序（先命中先用）：
 *   1. --config 显式路径
 *   2. data/audiobook/projects/<safeName(title)>.json   ← 人类可维护的推荐位置
 *   3. data/audiobook/projects/<projectId>.json
 * 均为可选：无配置 = 空表，管线行为与从前一致。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PronEntry, VoiceRule } from './annotate.ts';

export interface ProjectAudiobookConfig {
  /** 发音表：字面短语 → 朗读替换，长词优先 */
  pron?: PronEntry[];
  /** 角色名（含）→ 音色；按数组顺序首个命中生效。缺省回落 DEFAULT_VOICE_CONFIG。
   *  可选 rate/pitch 微调（per-speaker，如老者压低放慢）——edge 免费班底缩编后
   *  靠它把同音色压出区分度（2026-09-02 云野/晓涵下线事故） */
  voiceBySpeaker?: VoiceRule[];
  /** 角色名单（含别名，长名在前）：说话人归属校验 + 假名过滤 */
  cast?: string[];
  /** 场景图视觉风格（英文生图指令；extract-scenes 消费，per-book 定制） */
  sceneStyle?: string;
  /** 场景图角色/场景一致性表（英文；extract-scenes 消费） */
  sceneCharacters?: string;
  /** 旁白音色覆盖（edge 音色名，经引擎 VOICE_MAP 映射） */
  narrator?: string;
  /** 默认对白音色覆盖 */
  defaultSpeaker?: string;
}

export interface LoadedConfig {
  config: ProjectAudiobookConfig;
  source: string | undefined; // 命中的文件路径；undefined = 无配置
}

function safeName(title: string): string {
  return title.replace(/[^\p{Script=Han}A-Za-z0-9_-]/gu, '').slice(0, 60);
}

/** 同步读：配置极小，且 build 主流程需要它在进入循环前就绪 */
export function loadProjectConfig(opts: {
  explicit?: string;
  dataDir: string;
  projectId: string;
  title: string;
}): LoadedConfig {
  const candidates = opts.explicit
    ? [resolve(opts.explicit)]
    : [join(opts.dataDir, 'projects', `${safeName(opts.title)}.json`), join(opts.dataDir, 'projects', `${opts.projectId}.json`)];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as ProjectAudiobookConfig;
    if (raw.pron !== undefined && !Array.isArray(raw.pron)) throw new Error(`${p}: pron 需为数组`);
    if (raw.voiceBySpeaker !== undefined && !Array.isArray(raw.voiceBySpeaker)) throw new Error(`${p}: voiceBySpeaker 需为数组`);
    for (const r of raw.voiceBySpeaker ?? []) {
      if (r.rate !== undefined && !/^[+-]\d{1,3}%$/.test(r.rate)) throw new Error(`${p}: ${r.match} 的 rate 需形如 "-14%"`);
      if (r.pitch !== undefined && !/^[+-]\d{1,3}Hz$/.test(r.pitch)) throw new Error(`${p}: ${r.match} 的 pitch 需形如 "-10Hz"`);
    }
    return { config: raw, source: p };
  }
  return { config: {}, source: undefined };
}
