/**
 * DerivativeWork 契约（M2，双真形态驱动——audiobook + digest 落地后才抽取）：
 * 「书的一条衍生形态线」。施工禁令：只有两个真实实现共同需要的部分才进来；
 * 任何单形态特有的概念（TTS 引擎、浓缩风格、分镜表）留在各自包内。
 *
 * 现有实现：
 *   - audiobook：BookRegistry（registry.ts，episodes 为 units）
 *   - digest：DigestBook（registry.ts，pieces 为 units）
 * M3 接入（screenplay / comic_drama / ai_short）按同一形状新建自己的 registry：
 *   data/<kind>/registry.json，Record<bookId, DerivativeLine & 特有字段>，
 *   outRoot 固定 dist/derivatives/<slug>/<kind>/，单元编号走 nextUnitNumber。
 */

/** 衍生形态种类（M3 项为预留，未实现前不得写入各自 registry 之外的位置） */
export type DerivativeKind =
  | 'audiobook'
  | 'digest'
  | 'narration_video'
  | 'screenplay'
  | 'comic_drama'
  | 'ai_short';

/** 衍生单元（一集 / 一篇）的最小公共形状；单元 id 即 registry 键名（ep01 / p1），不在记录内重复 */
export interface DerivativeUnit {
  chapters: [number, number];       // 来源章范围
  isDraft?: boolean;                // 试产物不参与「下一单元」推断
  createdAt?: string;
}

/** 一条衍生线的最小公共形状（结构化满足：各包 registry 记录即本接口实例化） */
export interface DerivativeLine<Presets extends object, Unit extends DerivativeUnit> {
  outRoot: string;                  // 相对仓库根，固定落在 dist/derivatives/<slug>/<kind>/
  presets: Presets;                 // 制作预设（引擎/风格等，kind 特有字段在此）
  units: Record<string, Unit>;
}

/**
 * 下一单元编号：从 registry 键名（ep01 / p1 / …）取号，既有最大 n + 1；
 * excludeDraft=true 时试产稿不参与最大值推断。
 * audiobook 的 nextEpisodeHint 与 digest 的 nextPieceId 共用此编号规则。
 * （参数值类型放宽为 object：各形态单元字段不同，isDraft 经安全收窄读取，
 *   避免纯可选属性的弱类型检查误伤无该字段的形态）
 */
export function nextUnitNumber(
  units: Record<string, object>,
  opts: { excludeDraft?: boolean } = {},
): number {
  const nums = Object.entries(units)
    .filter(([, u]) => !opts.excludeDraft || !(u as { isDraft?: boolean }).isDraft)
    .map(([key]) => Number(key.replace(/^\D+/, '')) || 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}
