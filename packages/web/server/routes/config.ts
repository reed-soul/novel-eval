/**
 * 引擎配置路由 — Web 端切换引擎 / 模型 / 注入 API key
 *
 * 端点：
 *   GET  /api/config/engine          列出全部引擎 + 当前引擎 + key 状态
 *   PUT  /api/config/engine          切换引擎/模型 { active?, models?: { name: model } }
 *   PUT  /api/config/engine/keys     注入 API key { provider, key }
 *   GET  /api/config/engine/health   检测当前引擎可用性（调 isAvailable）
 */
import { Hono } from 'hono';
import type { EngineProvider } from '@novel-eval/shared';
import type { EngineRegistry } from '../engine-registry.ts';

export function configRoutes(registry: EngineRegistry) {
  const app = new Hono();

  // 列出全部引擎 + 当前引擎 + key 状态
  app.get('/engine', (c) => {
    return c.json({
      engines: registry.listEngines(),
      active: registry.getActiveName(),
    });
  });

  // 切换引擎 / 覆盖模型
  app.put('/engine', async (c) => {
    const body = await c.req.json<{
      active?: string;
      models?: Record<string, string>;
    }>().catch(() => ({}) as { active?: string; models?: Record<string, string> });

    try {
      if (body.models) {
        for (const [name, model] of Object.entries(body.models)) {
          registry.setModel(name, model);
        }
      }
      if (body.active) {
        registry.setActive(body.active);
      }
      return c.json({ ok: true, active: registry.getActiveName(), engines: registry.listEngines() });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  // 注入 API key
  app.put('/engine/keys', async (c) => {
    const body = await c.req.json<{ provider: EngineProvider; key: string }>();
    if (!body.provider || !body.key) {
      return c.json({ error: '需要 provider 和 key' }, 400);
    }
    registry.setKey(body.provider, body.key);
    return c.json({ ok: true, provider: body.provider, hasKey: true });
  });

  // 检测当前引擎可用性
  app.get('/engine/health', async (c) => {
    const engine = registry.getEngine();
    const available = await engine.isAvailable();
    return c.json({ available, engine: engine.name, model: registry.getActiveConfig().model });
  });

  return app;
}
