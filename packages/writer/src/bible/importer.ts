/**
 * Bible 导入器 — 双模式写作的「规格模式」入口
 *
 * 直接把创作者的结构化 bible JSON 写成 immutable revision 1 并激活。
 */
import { randomUUID } from 'node:crypto';

import type { DB } from '../db.ts';
import { projectId } from '../domain/ids.ts';
import { PlanningRepository, type BibleDocument } from '../repositories/planning-repository.ts';
import { ProjectRepository } from '../repositories/project-repository.ts';
import type {
  Bible, CoreSeed, CharacterDynamic, CharacterState,
  WorldBuilding, PlotArchitecture,
} from './types.ts';
import { buildBibleFullText } from './generator.ts';

export interface ImportBibleInput {
  coreSeed: { premise: string };
  characterDynamics: CharacterDynamic[];
  characterState?: {
    characters: {
      name: string;
      items?: string[];
      abilities?: string[];
      status: string;
      relationships?: string[];
      events?: string[];
    }[];
  };
  worldBuilding: WorldBuilding;
  plotArchitecture: PlotArchitecture;
}

class BibleImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BibleImportError';
  }
}

function validate(input: ImportBibleInput): void {
  const errs: string[] = [];
  if (!input.coreSeed?.premise || input.coreSeed.premise.length < 5) {
    errs.push('coreSeed.premise 至少 5 字');
  }
  if (
    !Array.isArray(input.characterDynamics)
    || input.characterDynamics.length < 3
    || input.characterDynamics.length > 6
  ) {
    errs.push('characterDynamics 需 3-6 个角色');
  }
  if (!input.worldBuilding?.physical || !input.worldBuilding?.social || !input.worldBuilding?.metaphorical) {
    errs.push('worldBuilding 需含 physical/social/metaphorical');
  }
  if (!input.plotArchitecture?.act1 || !input.plotArchitecture?.act2 || !input.plotArchitecture?.act3) {
    errs.push('plotArchitecture 需含 act1/act2/act3');
  }
  if (!Array.isArray(input.plotArchitecture?.foreshadows) || input.plotArchitecture.foreshadows.length < 1) {
    errs.push('plotArchitecture.foreshadows 至少 1 个');
  }
  if (errs.length) throw new BibleImportError('Bible 校验失败：\n  - ' + errs.join('\n  - '));
}

export interface ImportBibleOptions {
  db: DB;
  projectId: string;
  input: ImportBibleInput;
  topic: string;
  genre: string;
  audience: string;
}

export interface ImportBibleResult {
  bible: Bible;
}

/**
 * 导入结构化 bible，跳过 AI 雪花法。
 * 写入 immutable revision 1 并激活。若已有 active bible 则拒绝覆盖。
 */
export function importBible(opts: ImportBibleOptions): ImportBibleResult {
  const { db, input, topic, genre, audience } = opts;
  const id = projectId(opts.projectId);
  validate(input);

  const planning = new PlanningRepository(db);
  const projects = new ProjectRepository(db);
  const existing = planning.getActiveBibleForProject(id);
  if (existing) {
    throw new BibleImportError('项目已有 active bible，无法覆盖 immutable revision');
  }

  const characterState: CharacterState = input.characterState
    ? {
        characters: input.characterState.characters.map((c) => ({
          name: c.name,
          items: c.items ?? [],
          abilities: c.abilities ?? [],
          status: c.status,
          relationships: c.relationships ?? [],
          events: c.events ?? [],
        })),
      }
    : {
        characters: input.characterDynamics.map((c) => ({
          name: c.name,
          items: [],
          abilities: [],
          status: '（待设定）',
          relationships: [],
          events: [],
        })),
      };

  const coreSeed = input.coreSeed as CoreSeed;
  const fullText = buildBibleFullText({
    topic,
    genre,
    audience,
    coreSeed,
    characterDynamics: input.characterDynamics,
    characterState,
    worldBuilding: input.worldBuilding,
    plotArchitecture: input.plotArchitecture,
  });

  const bible: Bible = {
    coreSeed,
    characterDynamics: input.characterDynamics,
    characterState,
    worldBuilding: input.worldBuilding,
    plotArchitecture: input.plotArchitecture,
    fullText,
  };

  const now = new Date().toISOString();
  const revisionId = randomUUID();
  const document = {
    coreSeed: bible.coreSeed,
    characterDynamics: bible.characterDynamics,
    characterState: bible.characterState,
    worldBuilding: bible.worldBuilding,
    plotArchitecture: bible.plotArchitecture,
    fullText: bible.fullText,
  } as unknown as BibleDocument;

  planning.saveBibleRevision({
    id: revisionId,
    projectId: id,
    revisionNumber: 1,
    status: 'approved',
    bible: document,
    compiledText: fullText,
    createdAt: now,
  });
  projects.setActiveBibleRevision(id, revisionId, now);

  return { bible };
}
