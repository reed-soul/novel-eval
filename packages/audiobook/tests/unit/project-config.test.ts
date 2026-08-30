/**
 * per-project 配置发现：显式路径 > 书名文件 > 项目ID文件；无配置时零影响。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectConfig } from '../../src/project-config.ts';

test('发现顺序：书名文件优先于 id 文件，--config 显式覆盖一切', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'projcfg-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const projDir = join(dataDir, 'projects');
  await mkdir(projDir, { recursive: true });
  await writeFile(join(projDir, '最后一班森铁.json'), JSON.stringify({ pron: [{ match: 'A', read: 'B' }] }), 'utf-8');
  await writeFile(join(projDir, 'uuid-1.json'), JSON.stringify({ pron: [{ match: 'C', read: 'D' }] }), 'utf-8');
  const explicit = join(dataDir, 'explicit.json');
  await writeFile(explicit, JSON.stringify({ narrator: 'zh-CN-YunyeNeural' }), 'utf-8');

  const byTitle = loadProjectConfig({ dataDir, projectId: 'uuid-1', title: '最后一班森铁' });
  assert.equal(byTitle.config.pron?.[0].match, 'A');

  const byId = loadProjectConfig({ dataDir, projectId: 'uuid-1', title: '无关书名' });
  assert.equal(byId.config.pron?.[0].match, 'C');

  const byExplicit = loadProjectConfig({ explicit, dataDir, projectId: 'uuid-1', title: '最后一班森铁' });
  assert.equal(byExplicit.config.narrator, 'zh-CN-YunyeNeural');
  assert.equal(byExplicit.source, explicit);

  const none = loadProjectConfig({ dataDir, projectId: 'uuid-2', title: '无配置书' });
  assert.equal(none.source, undefined);
  assert.deepEqual(none.config, {});
});

test('脏配置（pron 非数组）给出可定位错误', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'projcfg-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const projDir = join(dataDir, 'projects');
  await mkdir(projDir, { recursive: true });
  const file = join(projDir, '坏配置.json');
  await writeFile(file, JSON.stringify({ pron: '不是数组' }), 'utf-8');
  assert.throws(() => loadProjectConfig({ dataDir, projectId: 'x', title: '坏配置' }), /pron 需为数组/);
});
