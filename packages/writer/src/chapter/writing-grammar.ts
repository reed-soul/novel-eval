/**
 * 写作语法：平台选的是哪套引擎，不是在番茄底座上叠几句。
 *
 * - retention：通用 / 番茄 / 盐选 — 钩子、快切、留存（旧路，字符串保持原样）
 * - literary：豆瓣 — 整套替换，禁止再要求每 500 字转折或章末生死钩子
 */
import type { TargetPlatform } from '../target-platform.ts';

export type WritingEngine = 'retention' | 'literary';

/**
 * 去 AI 味通用负面清单 — 所有平台共用，追加在平台指令尾部。
 * 来自 chinese-novelist-skill 的去 AI 味方法论（MIT），规则化凝练。
 */
const ANTI_AI_FLAVOR_DIRECTIVES: string[] = [
  '【去AI味（所有平台通用）】',
  '- 【忌堆砌形容词】"璀璨/瑰丽/宛如/不由得/心中涌起"类陈词每章合计最多出现 1 次；一个名词前最多一个形容词',
  '- 【忌抽象情绪陈述】不写"心中涌起复杂的情感"这类空泛陈述——改成具体的动作、表情或对话来呈现情绪',
  '- 【忌四字格律连用】"心潮澎湃、热血沸腾"式成语排比最多出现 1 次/章，高潮处用具体感官细节替代',
  '- 【长短句交替】紧张处短句连击，铺陈处长句舒展，禁止通篇等长句造成的机械节奏',
  '- 【细节具象化】笼统描述（"房间很乱"）换成可看见的具体细节（"桌上三个空罐，烟灰缸满出来"）',
  '- 【行为语言塑造】人物性格靠习惯性小动作与物件互动传递（碗口朝向、叠纸的动作次序），少用叙述者直接说明；配角的每句台词背后要有其自身动机',
  '- 【主角带着感情用脑子】主角解题用职业知识，但取证的镜头要对准"人"：验物时写出物主的脸、手、呼吸或沉默；关键线索优先从与人的对话/对视/触碰中产出，而非纯物件推理',
  // v4 处方（battle4：v3 只把情感挂道具，主角成了"把丧事当选题"的解谜机器）：
  // 旧版"严禁心路回忆"过度矫正——该禁的是抽象情绪标签，不是内心本身。
  '- 【情感双层落地】情感必须内外双层：外层用物理动作、规矩仪式与物件交互传递；内层必须写主角第一人称的身体化内心——手抖、喉咙发紧、突然听不清声音、闪回一个具体画面（≤2 句），每章至少 2 处，情感重场（丧亲/遗物/对峙）必写。仍严禁的是抽象情绪标签（"心中涌起复杂的情感""悲从中来"这类空话）；不禁具体的"我"的感受——读者因动作落泪的前提，是主角先是个会疼的人',
  '- 【灵异守规则】超自然现象只按已铺垫的规则发生；严禁无前置的自动显灵、自动书写、即时生效的迷药——若需新的灵异现象，先在前文立规',
];

export function writingEngineFor(platform: TargetPlatform): WritingEngine {
  return platform === 'douban' ? 'literary' : 'retention';
}

/** 正文生成用的平台指令（完整替换，不叠加）。 */
export function chapterWritingDirectives(platform: TargetPlatform, position: number): string[] {
  if (writingEngineFor(platform) === 'literary') {
    return [
      '【豆瓣阅读文学写法（替换网文留存语法，不要叠加番茄规矩）】',
      '- 【场景连续】一章优先待在同一时间、同一地点、同一视角。禁止无叙事必要的时空跳切和对位镜头硬切。',
      '- 【节奏】允许长段与内心。不要每 500 字强行制造转折或信息揭露。高潮处可用短句，日常处必须能停住。',
      '- 【章末】允许安静收束、画面停住或人物决定。禁止每章都用危机/身份败露/惊人发现/反转来吊下一章。',
      '- 【对话】仍要有潜台词或信息量，禁止寒暄废话。',
      '- 【推进】有信息增量，但增量可以是人物关系、生活质感或命运压力，不必每段都是线索爆点。',
      ...ANTI_AI_FLAVOR_DIRECTIVES,
    ];
  }
  return retentionChapterDirectives(platform, position);
}

function retentionChapterDirectives(platform: TargetPlatform, position: number): string[] {
  switch (platform) {
    case 'yanxuan':
      return [
        '【知乎盐选平台体裁与排版规范（严格执行）】',
        '- 【第一人称亲历感（POV）】：必须以第一人称「我」的视角进行高代入感、强主观沉浸叙事，严禁第三人称客观全知俯视。',
        '- 【知乎体短段落】：严格采用知乎体排版，单段绝对不超过 3 行，多用短句，拒绝任何大段沉闷文字。',
        position === 1
          ? '- 【黄金开局】：开篇前三段必须立刻抛出核心异常、不可思议的冲突或悬疑事件，禁止任何慢热铺垫。'
          : '- 【反转与节奏】：节奏“短、快、反转多”，对话针锋相对、信息密集，多处制造心理施压与信息差欺骗。',
        '- 【结局正义感】：正义必须得到实质伸张，罪罚严密对等，禁止反派软着陆。',
        ...ANTI_AI_FLAVOR_DIRECTIVES,
      ];
    case 'fanqie':
      return [
        '【番茄小说平台体裁与爽点规范（严格执行）】',
        '- 【高留存快节奏】：读者耐心极低，语言通俗精炼，禁止大段心理描写或静态景物描写。',
        position === 1
          ? '- 【黄金三章/极速出场】：主角必须在前500字内出场，且第一场戏必须遭遇危机、冲突或强动机事件。'
          : '- 【持续推背感】：每 500 字至少一个小转折或线索推进，全程高能。',
        '- 【章末生死断点钩子】：章节最后 150 字必须卡在最紧张、最意想不到的突发悬念断点上，让读者欲罢不能必须点击下一章！',
        ...ANTI_AI_FLAVOR_DIRECTIVES,
      ];
    case 'general':
    default:
      return [
        '【畅销网文通用规范】',
        '- 场景化推进，以人物对话与动作为主轴，节奏明快，每章末尾保留悬念钩子。',
        ...ANTI_AI_FLAVOR_DIRECTIVES,
      ];
  }
}

/** 蓝图用的平台短规范（注入 blueprint-chapters 的 PLATFORM_GUIDELINES）。 */
export function getPlatformGuidelines(platform: TargetPlatform): string {
  switch (platform) {
    case 'fanqie':
      return '番茄小说标准：快节奏强刺激。第1章主角必须在开场500字内出场并面临初始事件；每章末尾必须有高强度的“断点钩子（ending_hook）”以拉升连读率与留存率；拒绝拖沓与长段铺垫。';
    case 'yanxuan':
      return '知乎盐选标准：强反转、第一人称代入感。开篇前三段必须抛出核心异常或冲突，快速建立“我和当事人”的谜题框架；结尾强调反转或心理压迫感。';
    case 'douban':
      return '豆瓣阅读标准：生活流文学质感与扎实人物弧光，慢热友好。一章一条时间线；章末允许安静收束，禁止每章生死留存钩子；不要按番茄「每 500 字一转折」拆场景。';
    case 'general':
    default:
      return '通用畅销网文标准：注重起承转合，每章具备明确叙事目的与章末钩子，伏笔回收清晰。';
  }
}

/** 替换蓝图模板里「每章必须生死钩子」那几条。 */
export function blueprintChapterRules(platform: TargetPlatform): string {
  if (writingEngineFor(platform) === 'literary') {
    return [
      '- 每章要有：标题、定位（role）、核心作用（purpose）、悬念密度(0-10)、伏笔操作、转折程度(0-10)、梗概（summary）、章末收束（ending_hook，可空）',
      '- 【章末收束（ending_hook）】：有明确收束即可，允许安静落地、画面停住或人物决定；禁止每章都用同一套「危机/败露/发现/反转」吊胃口。ending_hook 可空。优先一章一条时间线，不要在一章里来回切年。',
    ].join('\n');
  }
  return [
    '- 每章要有：标题、定位（role）、核心作用（purpose）、悬念密度(0-10)、伏笔操作、转折程度(0-10)、梗概（summary）、章末强断点钩子（ending_hook）',
    '- 【章末强断点钩子（ending_hook）】：每章结尾必须设计生死留存钩子（危机、身份败露、意想不到的发现、反转），促使读者忍不住点击下一章',
  ].join('\n');
}

/** 蓝图 JSON 示例里的 ending_hook 字段（文学向不要示范成强悬念钩子）。 */
export function blueprintEndingHookJsonField(platform: TargetPlatform): string {
  if (writingEngineFor(platform) === 'literary') {
    return '"ending_hook": "章末收束（可空，允许安静落地）"';
  }
  return '"ending_hook": "章末强悬念钩子（20-60字）"';
}

export function formatEndingInstruction(platform: TargetPlatform, endingHook?: string): string {
  const hook = endingHook?.trim() ?? '';
  if (!hook) return '';
  if (writingEngineFor(platform) === 'literary') {
    return `【本章收束】：${hook}（允许安静落地，不要写成生死断点广告）`;
  }
  return `【本章必须达成的章末断点钩子】：${hook}`;
}

export function rewriteIntro(platform: TargetPlatform): string {
  if (writingEngineFor(platform) === 'literary') {
    return [
      '你是顶级畅销小说家。下面这章正文在某些维度得分偏低，请根据设定（见 system prompt 中的「小说设定」）、前情和【修正依据】，对这章做一次整章重写，针对性提升薄弱维度。',
      '目标读者要能慢慢看完——重写后保持场景连续，不要改成章末吊胃口的短剧。',
    ].join('\n');
  }
  return [
    '你是顶级畅销小说家。下面这章正文在某些维度得分偏低，请根据设定（见 system prompt 中的「小说设定」）、前情和【修正依据】，对这章做一次整章重写，针对性提升薄弱维度。',
    '你的目标读者是番茄小说的用户——重写后每章结尾仍要让他们忍不住点"下一章"。',
  ].join('\n');
}

export function rewriteKeepCore(platform: TargetPlatform): string {
  if (writingEngineFor(platform) === 'literary') {
    return '原章的情节骨架、关键线索、伏笔必须保留；章末若是安静收束，不要改成生死钩子';
  }
  return '原章的情节骨架、关键线索、伏笔、章末钩子必须保留，只改进呈现方式';
}

export function rewritePaceRules(platform: TargetPlatform): string {
  if (writingEngineFor(platform) === 'literary') {
    return [
      '- 【开头】承接前文即可，允许用一个连续场景进入，不要为了钩子硬切',
      '- 【场景化叙事】用对话、动作和感官细节推进，允许超过 3 行的内心与环境停留',
      '- 【对话有锋芒】每句对话都要有潜台词或信息量，禁止寒暄式废话对话',
      '- 【节奏控制】禁止为留存而每 500 字强行转折；一章优先待在同一时间线与场景，允许长段。章末不要改成套公式的断点钩子',
    ].join('\n');
  }
  return [
    '- 【开头即承接+推进】第一段就要有信息增量——要么推进剧情、要么揭露新线索、要么制造新冲突。禁止慢热开场',
    '- 【场景化叙事】全程用"对话+动作+感官细节"推进，禁止大段心理独白（不超过 3 行）',
    '- 【对话有锋芒】每句对话都要有潜台词或信息量，禁止寒暄式废话对话',
    '- 【节奏控制】短句制造紧张感，长句铺陈氛围。每 500 字至少一个小转折或信息揭露',
  ].join('\n');
}
