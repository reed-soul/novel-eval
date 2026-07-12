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
  temperature: number;
  bibleTemperature: number;
}

export interface WriterConfig {
  engine: EngineConfig;
  engineName: string;
  /** 全部引擎表（供 Web 端切换）*/
  engines: Record<string, EngineConfig>;
  generation: GenerationConfig;
}

export function loadWriterConfig(): WriterConfig {
  const { engine, engineName, engines } = loadEngineConfig(SHARED_CONFIG_DIR);
  const raw = loadYaml<{ generation: Partial<GenerationConfig> }>(
    resolve(WRITER_CONFIG_DIR, 'writer.yml'),
  );
  const generation: GenerationConfig = {
    defaultChapters: raw.generation?.defaultChapters ?? 50,
    chapterWordCount: raw.generation?.chapterWordCount ?? 2500,
    temperature: raw.generation?.temperature ?? 0.7,
    bibleTemperature: raw.generation?.bibleTemperature ?? 0.5,
  };
  return { engine, engineName, engines, generation };
}
