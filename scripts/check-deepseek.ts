/**
 * DeepSeek 连通性自检 — 验证 key 可用、模型可调、计费字段正常。
 * 用法：npx tsx scripts/check-deepseek.ts
 */
import { resolve } from 'node:path';
import { loadEnv } from '../packages/writer/src/load-env.ts';
import { loadEngineConfig } from '../packages/shared/src/config.ts';
import { createEngine } from '../packages/shared/src/engine/factory.ts';

loadEnv();
const { engine: cfg, engineName } = loadEngineConfig(
  resolve(process.cwd(), 'packages/shared/config'),
);
console.log('active engine:', engineName, '/', cfg.provider, '/', cfg.model);
console.log('baseUrl:', cfg.baseUrl);
console.log('DEEPSEEK_API_KEY present:', (process.env.DEEPSEEK_API_KEY ?? '').length > 0, '(len:', (process.env.DEEPSEEK_API_KEY ?? '').length, ')');

const engine = createEngine(cfg);
const ok = await engine.isAvailable();
if (!ok) {
  console.error('✗ engine.isAvailable() = false — key 未加载');
  process.exit(1);
}

console.log('sending minimal probe...');
try {
  const res = await engine.run('用一句话回答：1+1 等于几？', {
    maxTokens: 64,
    temperature: 0,
    disableThinking: true,
    timeoutMs: 30_000,
  });
  console.log('✓ response text:', JSON.stringify(res.text.slice(0, 120)));
  console.log('✓ usage:', JSON.stringify(res.usage));
  if (res.usage.costRmb === 0 && res.usage.inputTokens === 0 && res.usage.outputTokens === 0) {
    console.warn('⚠️ usage 全 0 — 计费字段异常，但不阻塞');
  }
  console.log('\n✅ DeepSeek 连通性 OK，可进入 bible 生成。');
} catch (e) {
  console.error('✗ 调用失败:', (e as Error).message);
  process.exit(2);
}
