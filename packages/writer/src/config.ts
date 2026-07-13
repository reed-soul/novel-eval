/**
 * writer 配置加载
 *
 * 读 writer.yml（生成参数）+ 复用 shared 的 engines.yml（引擎）。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYaml, loadEngineConfig } from '@novel-eval/shared';
import type { EngineConfig } from '@novel-eval/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WRITER_CONFIG_DIR = resolve(__dirname, 'config');
const SHARED_CONFIG_DIR = resolve(__dirname, '..', '..', 'shared', 'config');

export interface GenerationConfig {
  defaultChapters: number;
  chapterWordCount: number;
  recentWindow: number;
  arcInterval: number;
  temperatures: {
    chapter: number;
    blueprint: number;
    finalize: number;
    bible: number;
  };
  timeouts: {
    chapterMs: number;
    blueprintMs: number;
    finalizeMs: number;
    bibleMs: number;
  };
}

export interface QualityGateConfig {
  passGrade: string;
  passMinScore: number;
  minDimScore: number;
  blockGrade: string;
}

export interface RepetitionConfig {
  shingleSize: number;
  withinMild: number;
  withinSevere: number;
  crossMild: number;
  crossSevere: number;
}

export interface WriterConfig {
  engine: EngineConfig;
  engineName: string;
  /** 全部引擎表（供 Web 端切换）*/
  engines: Record<string, EngineConfig>;
  generation: GenerationConfig;
  qualityGate: QualityGateConfig;
  repetition: RepetitionConfig;
}

export function loadWriterConfig(): WriterConfig {
  const { engine, engineName, engines } = loadEngineConfig(SHARED_CONFIG_DIR);
  const raw = loadYaml<{
    generation?: Partial<{
      defaultChapters: number; chapterWordCount: number; recentWindow: number; arcInterval: number;
      temperatures: Partial<Record<'chapter' | 'blueprint' | 'finalize' | 'bible', number>>;
      timeouts: Partial<Record<'chapterMs' | 'blueprintMs' | 'finalizeMs' | 'bibleMs', number>>;
    }>;
    qualityGate?: Partial<QualityGateConfig>;
    repetition?: Partial<RepetitionConfig>;
  }>(resolve(WRITER_CONFIG_DIR, 'writer.yml'));

  const g = raw.generation ?? {};
  const generation: GenerationConfig = {
    defaultChapters: g.defaultChapters ?? 50,
    chapterWordCount: g.chapterWordCount ?? 2500,
    recentWindow: g.recentWindow ?? 5,
    arcInterval: g.arcInterval ?? 10,
    temperatures: {
      chapter: g.temperatures?.chapter ?? 0.7,
      blueprint: g.temperatures?.blueprint ?? 0.5,
      finalize: g.temperatures?.finalize ?? 0.4,
      bible: g.temperatures?.bible ?? 0.5,
    },
    timeouts: {
      chapterMs: g.timeouts?.chapterMs ?? 300_000,
      blueprintMs: g.timeouts?.blueprintMs ?? 180_000,
      finalizeMs: g.timeouts?.finalizeMs ?? 120_000,
      bibleMs: g.timeouts?.bibleMs ?? 120_000,
    },
  };

  const qg = raw.qualityGate ?? {};
  const qualityGate: QualityGateConfig = {
    passGrade: qg.passGrade ?? 'B',
    passMinScore: qg.passMinScore ?? 75,
    minDimScore: qg.minDimScore ?? 65,
    blockGrade: qg.blockGrade ?? 'C',
  };

  const rep = raw.repetition ?? {};
  const repetition: RepetitionConfig = {
    shingleSize: rep.shingleSize ?? 8,
    withinMild: rep.withinMild ?? 0.15,
    withinSevere: rep.withinSevere ?? 0.30,
    crossMild: rep.crossMild ?? 0.25,
    crossSevere: rep.crossSevere ?? 0.50,
  };

  return { engine, engineName, engines, generation, qualityGate, repetition };
}
