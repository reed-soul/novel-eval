/**
 * Spike 一键复跑：Map → R2 串行执行
 * 用法：npm run spike:all
 */
import './load-env.mjs';
import { execSync } from 'node:child_process';

console.log('════════════════════════════════════');
console.log('  Novel Eval Spike — 一键复跑');
console.log('════════════════════════════════════\n');

const steps: Array<{ name: string; script: string }> = [
  { name: 'Step 3: Map（逐章评估）', script: 'spike:map' },
  { name: 'Step 4: R2（五维评分）', script: 'spike:reduce' },
];

for (const step of steps) {
  console.log(`\n▶ 执行 ${step.name} ...\n`);
  try {
    execSync(`npm run ${step.script}`, { stdio: 'inherit', env: process.env });
  } catch (e) {
    console.error(`\n✗ ${step.name} 失败，终止。`);
    process.exit(1);
  }
}

console.log('\n════════════════════════════════════');
console.log('  Spike 全部完成');
console.log('  结果：spike/output/{map,r2}-results.json');
console.log('  报告：docs/spike/2026-07-08-spike-report.md');
console.log('════════════════════════════════════');
