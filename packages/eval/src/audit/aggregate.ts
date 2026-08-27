/**
 * Audit 聚合：图分析结果 + 建链嫌疑 + 探针/红队产出 → 去重排序的逻辑洞清单
 */
import type {
  GraphAnalysisResult,
  GraphNode,
  HoleSeverity,
  LinkResult,
  LogicHole,
  LogicHoleType,
  ProbeHole,
} from './types.ts';
import { LOGIC_HOLE_TYPES } from './types.ts';

const SEVERITY_ORDER: Record<HoleSeverity, number> = { P0: 0, P1: 1, P2: 2 };

/** 图分析（确定性）→ 洞 */
export function holesFromGraph(
  analysis: GraphAnalysisResult,
  nodesById: Map<string, GraphNode>,
): LogicHole[] {
  const holes: LogicHole[] = [];
  let seq = 0;
  const push = (h: Omit<LogicHole, 'id' | 'source' | 'evidence'> & { evidence: LogicHole['evidence'] }) => {
    holes.push({ ...h, id: `g${++seq}`, source: 'graph' });
  };

  // 断链：关键事件无因果前置
  for (const n of analysis.chainBreaks) {
    const isEvidence = n.event.isEvidence;
    push({
      type: isEvidence ? 'missing-enablement' : 'causal-break',
      severity: analysis.climaxNodeIds.has(n.globalId) ? 'P0' : 'P1',
      title: `${n.globalId} ${n.event.description.slice(0, 30)}——无因果前置`,
      detail: `该事件位于${isEvidence ? '后半书证据' : '高潮'}关键位置，但事件图中没有任何物理因果/动机/使能类的前置边指向它——它凭空成立。可能是前文确实交代过但未被抽取到（人工复核），也可能是因果跳步。时间标记：${n.event.timeMarker || '无'}。`,
      evidenceChapterIds: [n.chapterId],
      evidenceQuote: n.event.quote,
      suggestedFix: isEvidence
        ? '在事件前 1-2 章补一幕取得过程（谁提供、以什么手段、付出什么代价）'
        : '补齐该关键转折的前置事件，或将其改为由既有事件推动',
      fixCost: isEvidence ? 'surgical' : 'rewrite',
      evidence: [{ chapterId: n.chapterId, quote: n.event.quote, note: n.event.description }],
    });
  }

  // 孤悬情节
  if (analysis.orphans.length > 0) {
    const sample = analysis.orphans.slice(0, 5);
    push({
      type: 'orphan-plot',
      severity: 'P2',
      title: `${analysis.orphans.length} 个事件对后续零影响（孤悬）`,
      detail: `以下事件既没有出边（不引发任何后续事件），也不在通往高潮的主因果链上：\n${sample.map((n) => `- ${n.globalId} ${n.event.description}`).join('\n')}${analysis.orphans.length > 5 ? `\n（其余 ${analysis.orphans.length - 5} 个见 orphanEventIds）` : ''}\n注意：部分孤悬可能是抽取漏连（人工复核），确认后或删或接线。`,
      evidenceChapterIds: [...new Set(sample.map((n) => n.chapterId))],
      evidenceQuote: sample[0]?.event.quote ?? '',
      suggestedFix: '逐个判断：删掉不影响主线的删掉；有价值的接线到主因果链',
      fixCost: 'surgical',
      evidence: sample.map((n) => ({ chapterId: n.chapterId, quote: n.event.quote, note: n.event.description })),
    });
  }

  // 时间线矛盾
  for (const t of analysis.timelineConflicts) {
    push({
      type: 'timeline-contradiction',
      severity: 'P1',
      title: `${t.storyline}：年份随章序倒错（${t.earlier.event.yearHint} → ${t.later.event.yearHint}）`,
      detail: `「${t.earlier.chapterId} ${t.earlier.event.description}」标记年份 ${t.earlier.event.yearHint}（${t.earlier.event.timeMarker || '无时间短语'}），其后「${t.later.chapterId} ${t.later.event.description}」标记年份 ${t.later.event.yearHint}（${t.later.event.timeMarker || '无时间短语'}）。同线叙事中时间不应倒退。若此处是刻意闪回可忽略，否则是硬伤（如「二十年前/十二年前」类口误）。`,
      evidenceChapterIds: [t.earlier.chapterId, t.later.chapterId],
      evidenceQuote: t.later.event.quote,
      suggestedFix: '统一年数口径；若是闪回，在文中给明确的时间切换信号',
      fixCost: 'surgical',
      evidence: [
        { chapterId: t.earlier.chapterId, quote: t.earlier.event.quote, note: `yearHint=${t.earlier.event.yearHint}` },
        { chapterId: t.later.chapterId, quote: t.later.event.quote, note: `yearHint=${t.later.event.yearHint}` },
      ],
    });
  }

  // 巧合驱动
  if (analysis.coincidenceEvents.length >= 2) {
    const count = analysis.coincidenceEvents.length;
    const touchesClimax = analysis.coincidenceEvents.some((n) => analysis.climaxNodeIds.has(n.globalId));
    push({
      type: 'coincidence-driven',
      severity: touchesClimax ? 'P0' : count >= 3 ? 'P1' : 'P2',
      title: `主因果链上存在 ${count} 个巧合事件`,
      detail: `以下「恰好/碰巧」事件全部落在通往高潮的主链上：\n${analysis.coincidenceEvents.map((n) => `- ${n.globalId} ${n.event.description}（${n.chapterId}）`).join('\n')}\n范达因规则：关键定罪不得依赖巧合。巧合数 ≥3 或巧合直接支撑高潮时，编辑推敲两下就会得出「剧情经不起推敲」。`,
      evidenceChapterIds: [...new Set(analysis.coincidenceEvents.map((n) => n.chapterId))],
      evidenceQuote: analysis.coincidenceEvents[0].event.quote,
      suggestedFix: '把「恰好」改为人物主动设计：让某个反派的疏忽或某个配角的有意为之成为证据留存的因果',
      fixCost: 'surgical',
      evidence: analysis.coincidenceEvents.slice(0, 5).map((n) => ({
        chapterId: n.chapterId, quote: n.event.quote, note: n.event.description,
      })),
    });
  } else if (analysis.coincidenceEvents.length === 1) {
    const n = analysis.coincidenceEvents[0];
    push({
      type: 'coincidence-driven',
      severity: 'P2',
      title: `主链上单个巧合事件：${n.globalId}`,
      detail: `${n.event.description}（${n.chapterId}）依赖偶然成立。单个巧合可容忍，但注意其位置越靠近高潮越危险。`,
      evidenceChapterIds: [n.chapterId],
      evidenceQuote: n.event.quote,
      suggestedFix: '给偶然一个设计者（谁让它恰好发生）',
      fixCost: 'surgical',
      evidence: [{ chapterId: n.chapterId, quote: n.event.quote, note: n.event.description }],
    });
  }

  // 枢纽依赖
  if (analysis.hubReport) {
    const { character, share, mainEvents } = analysis.hubReport;
    push({
      type: 'hub-dependence',
      severity: 'P2',
      title: `主因果链 ${Math.round(share * 100)}% 的事件悬挂在「${character}」身上`,
      detail: `主因果链共 ${analysis.mainChain.size} 个事件，其中 ${mainEvents} 个有「${character}」参与。此人物一旦逻辑失守（动机不足、信息越界），全书主链连锁崩塌——单点依赖过高。`,
      evidenceChapterIds: [],
      evidenceQuote: '',
      suggestedFix: '把部分关键节点的推动力分散给第二人物（如让证据链有第二个独立来源）',
      fixCost: 'rewrite',
      evidence: [],
    });
  }

  return holes;
}

/** 建链嫌疑（LLM 全局视角）→ 洞 */
export function holesFromSuspicions(
  suspicions: LinkResult['suspicions'],
  nodesById: Map<string, GraphNode>,
): LogicHole[] {
  return suspicions
    .filter((s) => nodesById.has(s.globalEventId))
    .map((s, i) => {
      const n = nodesById.get(s.globalEventId)!;
      const type: LogicHoleType =
        s.kind === 'convenience' ? 'coincidence-driven'
        : s.kind === 'unclear' ? 'fact-contradiction'
        : n.event.isEvidence ? 'missing-enablement' : 'causal-break';
      return {
        id: `l${i + 1}`,
        source: 'link' as const,
        type,
        severity: 'P1' as HoleSeverity,
        title: `${s.globalEventId} ${n.event.description.slice(0, 26)}——${s.kind === 'unclear' ? '前后不一' : '前置缺失'}`,
        detail: s.note,
        evidenceChapterIds: [n.chapterId],
        evidenceQuote: n.event.quote,
        suggestedFix: '补前置事件或统一口径',
        fixCost: 'surgical' as const,
        evidence: [{ chapterId: n.chapterId, quote: n.event.quote, note: s.note }],
      };
    });
}

function normalizeProbeHole(h: ProbeHole, source: LogicHole['source'], seq: number): LogicHole | null {
  if (!LOGIC_HOLE_TYPES.includes(h.type)) return null;
  const severity = ['P0', 'P1', 'P2'].includes(h.severity) ? h.severity : 'P2';
  const chapterIds = Array.isArray(h.evidenceChapterIds) ? h.evidenceChapterIds : [];
  return {
    id: `${source[0]}${seq}`,
    source,
    type: h.type,
    severity,
    title: h.title,
    detail: h.detail,
    evidenceChapterIds: chapterIds,
    evidenceQuote: h.evidenceQuote ?? '',
    suggestedFix: h.suggestedFix,
    fixCost: h.fixCost === 'rewrite' ? 'rewrite' : 'surgical',
    evidence: chapterIds.map((chapterId) => ({ chapterId, quote: h.evidenceQuote ?? '' })),
  };
}

/** 去重合并：同 type + 章节重叠 → 合并（保severity更高、证据并集），再按严重度+章序排序 */
export function aggregateHoles(
  graphHoles: LogicHole[],
  linkHoles: LogicHole[],
  fairplayHoles: ProbeHole[],
  plausibilityHoles: ProbeHole[],
  redteamHoles: ProbeHole[],
): LogicHole[] {
  const normalized: LogicHole[] = [
    ...graphHoles,
    ...linkHoles,
    ...fairplayHoles.map((h, i) => normalizeProbeHole(h, 'fairplay', i + 1)).filter((h): h is LogicHole => h !== null),
    ...plausibilityHoles.map((h, i) => normalizeProbeHole(h, 'plausibility', i + 1)).filter((h): h is LogicHole => h !== null),
    ...redteamHoles.map((h, i) => normalizeProbeHole(h, 'redteam', i + 1)).filter((h): h is LogicHole => h !== null),
  ];

  // 合并：同 type 且 primary 章节相同
  const merged = new Map<string, LogicHole>();
  for (const h of normalized) {
    const primary = h.evidenceChapterIds[0] ?? '';
    const key = `${h.type}|${primary}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, h);
      continue;
    }
    // 保严重度更高者为主体，合并证据与来源
    const [base, extra] = SEVERITY_ORDER[h.severity] < SEVERITY_ORDER[existing.severity]
      ? [h, existing] : [existing, h];
    merged.set(key, {
      ...base,
      detail: base.detail === extra.detail ? base.detail : `${base.detail}\n〔${extra.source} 补充〕${extra.title}`,
      evidence: [...base.evidence, ...extra.evidence].slice(0, 8),
      evidenceChapterIds: [...new Set([...base.evidenceChapterIds, ...extra.evidenceChapterIds])],
    });
  }

  const chapterRank = (h: LogicHole): number => {
    const first = h.evidenceChapterIds[0] ?? 'zzz';
    return Number(first.replace(/\D/g, '')) || 999;
  };

  return [...merged.values()].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || chapterRank(a) - chapterRank(b),
  );
}
