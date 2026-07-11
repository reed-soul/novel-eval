import type { Character } from '../../types.ts';

export interface GraphNode {
  id: string;
  name: string;
  symbolSize: number;
  category: number;
}

export interface GraphLink {
  source: string;
  target: string;
  value: number;
  label: { show: boolean; formatter: string };
}

export interface RelationGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  hasGraph: boolean;
}

/** 构建人物关系图数据（纯逻辑，可单测） */
export function buildRelationGraph(characters: Character[], maxNodes = 15): RelationGraphData {
  const sorted = [...characters]
    .sort((a, b) => (b.keyChapters?.length ?? 0) - (a.keyChapters?.length ?? 0))
    .slice(0, maxNodes);
  const nameSet = new Set(sorted.map((c) => c.name));

  const nodes: GraphNode[] = sorted.map((c, i) => ({
    id: c.name,
    name: c.name,
    symbolSize: 20 + Math.min(30, (c.keyChapters?.length ?? 1) * 6),
    category: i % 3,
  }));

  const links: GraphLink[] = [];
  for (const c of sorted) {
    for (const rel of c.relationships ?? []) {
      if (!nameSet.has(rel.target) || rel.target === c.name) continue;
      links.push({
        source: c.name,
        target: rel.target,
        value: rel.strength,
        label: { show: true, formatter: rel.type },
      });
    }
  }

  return { nodes, links, hasGraph: nodes.length >= 2 && links.length >= 1 };
}
