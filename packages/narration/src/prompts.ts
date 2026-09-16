/**
 * 解说文案四阶段 Prompt（PLAN v2 §3，内容评审 9 条规范全部落入硬约束）
 * P0 全书物证-反转图谱 → P1 带物证锁的逐章 map → P2 序列规划（张力预算）→ P3 序列内 beat 生成
 */
import type { CharacterRef } from '@novel-eval/shared';

/** 负向词库（内容评审规范 2）：命中即结构门 FAILED + 重试 */
export const NEGATIVE_LEXICON: string[] = [
  '注意看', '不得不说', '细思极恐', '屏幕前的小伙伴', '屏幕前的', '大快人心',
  '然而事情并没有那么简单', '然而事情并没有这么简单', '殊不知', '埋下了伏笔', '这为后来',
  '你敢相信吗', '接下来的画面', '让人震惊的是', '全网泪崩',
];

const NINE_RULES = `【九条铁律（违反任意一条即废稿）】
1. 冷开场=物证落差法：开场首句必须是【冷峻精确的事实数据】+【反常理的物理动作】。严禁悬念反问（"你敢相信吗""这背后隐藏着什么"）、严禁"事情还要从…说起"。
2. 禁用油腻解说腔与上帝视角废话："注意看/不得不说/细思极恐/然而事情并没有那么简单/殊不知/这为后来埋下伏笔"等一律禁止。
3. 物证锚定：每推进一个关键反转，口播必须挂至少一件可视觉化的实物道具（药盒盖的铅笔字/断裂的棉线/冷冻的搪瓷缸）。用动作与物证表达怀疑，严禁"她感到非常疑惑"式抽象情绪词。
4. 人物复杂度锁：反派有算计也有体面，废物子女是懦弱被诱骗而非恶魔，受害者母亲是设防的疲惫者而非复仇爽文主角。口吻克制，严禁煽动网暴式情绪对立。
5. 句长节奏律：日常推演段单句 15–25 字、多用逗号；高潮揭秘段切 8–14 字极短句、高频句号（如："门开了。不是弟弟。是一张笑脸。"）。
6. 声画分工：text 只承载事件/潜台词/时间压力；visual.prompt 只承载 16:9 电影质感的物证、环境、背影、手部特写。画面严禁图解文字（text 说"她数药"，画面给"药盒盖内侧的铅笔数字特写"，不给"一个女人数药"）。
7. 正脸稀缺：shot=face 的分镜不超过全片 15%。悬疑观众要的是破案感，人物以背影/手部/剪影/中远景出现。
8. 结尾余音：最后 40 秒定格一个具体的物理画面与微小生活细节，严禁道德升华、严禁总结人生道理。
9. 高潮保护：情感清算幕的核心序列必须有充足口播空间（长句铺叙+留白），禁止为凑节奏点把高潮切碎。`;

export function systemPrompt(): string {
  return `你是顶级悬疑解说视频编剧，为 YouTube 中文悬疑频道写 25–35 分钟解说口播稿。你写的是"以视听节奏为尺子的戏剧重构"，不是小说缩写。
${NINE_RULES}

输出要求：只输出指定 JSON，不要 markdown 代码块包裹，不要解释。`;
}

/** P0：全书物证-反转图谱（一次通读，产 clue-graph 注入后续所有阶段） */
export function clueGraphPrompt(bookTitle: string, fullText: string): string {
  return `通读全书《${bookTitle}》，提取「物证-反转图谱」。这是解说文案的总纲：孤立看每一章会误删的伏笔，靠这张表保命。

任务：
1. clues：全书所有"草蛇灰线"式物证/微小动作（前文闲笔、后文核弹）。例如：第一章冰箱里冻着的一杯茶、被角夹层、棉线封条——凡是"出现时不像线索、兑现时是核弹"的实物。
2. reversals：反转层级表（表面真相→反转一→…→终极反转），每层写清"兑现章"与"依赖的伏笔"。
3. characters：主要人物卡（英文外貌描述供生图）+ 每人的"道德复杂度锁"（一句话：他是什么、绝不是什么）。
4. endingImage：全书最具象征意义的收尾物理画面（用于余音结尾）。

输出 JSON：
{"clues":[{"name":"物证名","plantChapters":[章号],"payoffChapter":章号,"desc":"一句话"}],
 "reversals":[{"layer":1,"desc":"本层反转","payoffChapter":章号,"dependsOn":["依赖的clue name"]}],
 "characters":[{"name":"中文名","promptDesc":"英文外貌角色卡（年龄/发型/标志性服装/气质）","moralityLock":"是什么，绝不是什么"}],
 "endingImage":"物理画面描述"}

全书文本：
<book>
${fullText}
</book>`;
}

/** P1：带物证锁的逐章 map（事实表是 S3 因果稽核的对照源） */
export function mapPrompt(chapterNo: number, chapterText: string, clueGraphJson: string): string {
  return `你在为解说视频做第 ${chapterNo} 章的浓缩。下面是全书「物证-反转图谱」：

<clue-graph>
${clueGraphJson}
</clue-graph>

⚠️ 物证锁：本章正文若出现图谱 clues 中的任何物证或其变体，summary 与 clueHits 必须原样保留该物证，严禁当作"闲笔细节"删除——解说后段的核弹反转全靠它们。

任务：浓缩本章为 150–300 字摘要，并产出结构化事实表。
输出 JSON：
{"summary":"150-300字章摘要（含物证锚点）",
 "facts":[{"subject":"人物/主体","action":"关键动作","object":"受体/对象"}],
 "clueHits":["本章出现的 clue name"],
 "emotionWeight":1-5,
 "sourceRange":[章号,章号]}

本章正文：
<chapter>
${chapterText}
</chapter>`;
}

/** P2：序列规划（三幕 + 4–5 解谜闭环 + 张力预算） */
export function sequencePlanPrompt(
  bookTitle: string,
  targetMinutes: number,
  clueGraphJson: string,
  mapsJson: string,
): string {
  const totalChars = Math.round(targetMinutes * 60 * 4.4);
  return `为《${bookTitle}》规划 ${targetMinutes} 分钟解说的「幕-序列」骨架。

<clue-graph>
${clueGraphJson}
</clue-graph>

<各章摘要与事实表>
${mapsJson}
</各章摘要与事实表>

节奏模型（必须遵守）：
- 三幕：a1 悬念建构（约前 27%）/ a2 破局博弈（中段 50%）/ a3 情感清算（末 23%）。
- 序列 = 解谜闭环：每个序列解开一个疑点、引出更深疑点；序列数 = max(4, round(${targetMinutes}/6)) 附近。
- 张力预算≠均摊：高潮序列（情感核弹）预算上浮 60–100%，日常推演收紧。budgetChars 总和 ≈ ${totalChars}。
- 每个序列 title 是营销化诱饵句（YouTube 章节直接用，如"药盒里多出来的七粒"），严禁"第一幕/真相大白"式平题。
- 首序列必须以全书最强物证开场（In Media Res 倒叙允许，但因果不得倒置）。

输出 JSON：
{"acts":[{"id":"a1","name":"悬念建构"}],
 "sequences":[{"id":"q1","actId":"a1","title":"营销化标题","puzzleLabel":"疑点一句话","budgetChars":1200,"tension":"low|mid|high|climax","sourceChapters":[章号],"beatCountHint":8}]}`;
}

/** P3：序列内 beat 生成（每序列一次独立调用，防 60+ 扁平数组注意力塌陷） */
export function beatsPrompt(args: {
  bookTitle: string;
  sequenceJson: string;
  sequenceMapsJson: string;
  clueGraphJson: string;
  characters: CharacterRef[];
  actName: string;
  isFirstSequence: boolean;
  isLastSequence: boolean;
  endingImage?: string;
}): string {
  const { bookTitle, sequenceJson, sequenceMapsJson, clueGraphJson, characters, actName, isFirstSequence, isLastSequence, endingImage } = args;
  const charList = characters.map((c) => `- ${c.name}（id=${c.id}）：${c.promptDesc}`).join('\n');
  return `为《${bookTitle}》解说稿生成序列「${actName}」内的 beat 序列。

<本序列规划>
${sequenceJson}
</本序列规划>

<本序列来源章节摘要与事实表>
${sequenceMapsJson}
</本序列来源章节摘要与事实表>

<clue-graph>
${clueGraphJson}
</clue-graph>

<角色表（characterIds 只能用这里的 id）>
${charList}
</角色表>

生成规则：
- 口播字数贴近 budgetChars（±10%）；每个 beat 的 sentences 按 15–30 字一句切分（高潮段 8–14 字短句）。
- ${isFirstSequence ? '本序列第一个 beat kind="hook"：物证落差法冷开场（精确数据+反常物理动作），倒叙允许。' : '首 beat 承接上一序列的悬置疑点。'}
- ${isLastSequence ? `本序列最后两个 beat：一个 kind="close"（情感清算，长句留白），一个 kind="coda"（余音结尾：定格物理画面${endingImage ? '（' + endingImage + '）' : ''}，严禁说教），coda 之后不需要再有任何 beat。` : '末 beat 以未解疑点悬置收尾（hook 下个序列），但严禁"然而事情没那么简单"式废话。'}
- turn/peak 分布：本序列内至少一个 peak（tension=climax 序列至少两个）；sfxHint 在 turn/peak 上给 stinger/heartbeat/tick。
- visual.prompt 全英文、16:9、电影质感，以物证/环境/背影/手部为主（shot 对应标注），face ≤ 15%。
- 母亲遗言/录音笔/微信语音类原声引语：sentence 加 quote:{voice:"elderly_warm",eq:"recorder"}。

输出 JSON：
{"beats":[{"id":"b001","kind":"hook|turn|peak|close|coda",
  "sentences":[{"id":"s0001","text":"口播句","quote":{"voice":"elderly_warm","eq":"recorder"}}],
  "visual":{"prompt":"english image prompt","characterIds":["c-xxx"],"shot":"prop|env|back|hands|face"},
  "sfxHint":"stinger|heartbeat|tick|none"}]}

beat id 从 b001 连续编号；sentence id 从 s0001 连续编号。只输出 JSON。`;
}

/** S3 因果稽核门（对照 P1 事实表，查因果倒置与人设变形） */
export function causalProbePrompt(scriptNarrationText: string, mapsFactsJson: string, moralityLocksJson: string): string {
  return `你是事实稽核员。解说词允许压缩、重排顺序、艺术加工，但严禁两类错误：
A. 因果倒置/张冠李戴：把甲做的事安到乙头上（尤其"被骗/被利用者"被写成"主动加害者"）。
B. 人设变形：突破人物的道德复杂度锁（如把懦弱棋子写成恶魔、把设防母亲写成复仇爽文女主）。

<解说词全文>
${scriptNarrationText}
</解说词全文>

<原著各章事实三元组（对照基准）>
${mapsFactsJson}
</原著各章事实三元组>

<人物道德锁>
${moralityLocksJson}
</人物道德锁>

逐段核对解说词。叙事顺序重排、合理删减、比喻加工——一律豁免。只报实质错误。
输出 JSON：
{"passed":true/false,"violations":[{"beatId":"bxxx","claim":"解说词原句","problem":"因果/人设错在哪，正确事实是什么"}]}`;
}
