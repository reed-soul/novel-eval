/**
 * 运行时配置单例 — 写作管线的全局参数源
 *
 * loadWriterConfig() 的结果缓存为单例，避免每个文件反复读 YAML。
 * 所有模块从 getRuntimeConfig() 获取温度/超时/阈值，消除硬编码常量。
 *
 * 测试可用 setRuntimeConfig() 注入 mock 值。
 */
import { loadWriterConfig, type WriterConfig } from './config.ts';

let cached: WriterConfig | null = null;

export function getRuntimeConfig(): WriterConfig {
  if (!cached) cached = loadWriterConfig();
  return cached;
}

/** 测试用：注入自定义配置（不影响磁盘 YAML）*/
export function setRuntimeConfig(config: WriterConfig): void {
  cached = config;
}

/** 测试用：重置为从磁盘加载 */
export function resetRuntimeConfig(): void {
  cached = null;
}
