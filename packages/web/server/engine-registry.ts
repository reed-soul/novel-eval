/**
 * EngineRegistry — Web 端运行时引擎状态
 *
 * 启动时从 engines.yml 加载全部引擎 + 默认引擎。
 * 运行时允许：
 *   - 切换当前引擎（bigmodel ↔ deepseek）
 *   - 覆盖某引擎的模型（如 deepseek-v4-pro ↔ deepseek-v4-flash）
 *   - 注入 API key（写 process.env，adapter 构造时读取）
 *
 * 引擎实例按需创建（切换/改模型后重建）。
 * 仅内存态（重启回到 engines.yml 默认值）——本地工具足够。
 */
import type { AIAgentAdapter, EngineConfig, EngineProvider } from '@novel-eval/shared';
import { createEngine } from '@novel-eval/shared';

/** 各 provider 对应的环境变量名（adapter 构造时读取）*/
const KEY_ENV: Record<EngineProvider, string> = {
  bigmodel: 'ANTHROPIC_AUTH_TOKEN', // 智谱：优先读 ANTHROPIC_AUTH_TOKEN，回退 ZHIPUAI_API_KEY
  deepseek: 'DEEPSEEK_API_KEY',
};

export interface EngineInfo {
  name: string;
  provider: EngineProvider;
  model: string;
  hasKey: boolean;
}

export class EngineRegistry {
  private engines: Record<string, EngineConfig>;
  private activeName: string;
  private activeEngine: AIAgentAdapter | null = null;

  constructor(engines: Record<string, EngineConfig>, defaultName: string) {
    this.engines = engines;
    this.activeName = defaultName;
  }

  /** 全部引擎信息（供 Web 端展示）*/
  listEngines(): EngineInfo[] {
    return Object.entries(this.engines).map(([name, cfg]) => ({
      name,
      provider: cfg.provider,
      model: cfg.model,
      hasKey: this.hasKey(cfg.provider),
    }));
  }

  getActiveName(): string {
    return this.activeName;
  }

  getActiveConfig(): EngineConfig {
    return this.engines[this.activeName];
  }

  getEngineConfig(name: string): EngineConfig | undefined {
    return this.engines[name];
  }

  /** 当前引擎实例（懒构造，切换/改模型后重建）*/
  getEngine(): AIAgentAdapter {
    if (!this.activeEngine) {
      this.activeEngine = createEngine(this.getActiveConfig());
    }
    return this.activeEngine;
  }

  /** 切换当前引擎 */
  setActive(name: string): void {
    if (!this.engines[name]) throw new Error(`未知引擎：${name}`);
    if (name !== this.activeName) {
      this.activeName = name;
      this.activeEngine = null; // 重建
    }
  }

  /** 覆盖某引擎的模型（重建该引擎的实例）*/
  setModel(name: string, model: string): void {
    if (!this.engines[name]) throw new Error(`未知引擎：${name}`);
    this.engines[name] = { ...this.engines[name], model };
    if (name === this.activeName) this.activeEngine = null; // 重建当前
  }

  /** 注入 API key（写 process.env，adapter 构造时读取）*/
  setKey(provider: EngineProvider, key: string): void {
    const envName = KEY_ENV[provider];
    process.env[envName] = key;
    // 智谱回退到 ZHIPUAI_API_KEY
    if (provider === 'bigmodel') process.env.ZHIPUAI_API_KEY = key;
    this.activeEngine = null; // key 变了，重建实例
  }

  hasKey(provider: EngineProvider): boolean {
    const envName = KEY_ENV[provider];
    if (provider === 'bigmodel') {
      return !!(process.env[envName] ?? process.env.ZHIPUAI_API_KEY);
    }
    return !!process.env[envName];
  }
}
