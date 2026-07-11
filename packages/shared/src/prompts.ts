/**
 * Prompt 加载（参数化目录，eval/writer 各自指定自己的 prompts 目录）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 读取 prompt 文件。
 * @param name prompt 名（不含扩展名）
 * @param dir  prompt 所在目录（eval/writer 各自通过 import.meta.url 定位）
 */
export function loadPrompt(name: string, dir: string): string {
  return readFileSync(resolve(dir, `${name}.md`), 'utf-8');
}
