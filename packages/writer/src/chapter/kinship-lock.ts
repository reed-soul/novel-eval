/**
 * 亲缘人名锁定（battle4 v4-待办④）。
 *
 * battle4 实锤：第 6 章"阮长贵，我爸的亲笔签名"——父亲名字与设定漂移，
 * 长程一致性缺口。状态机的 facts 由 LLM 抽取、天然不稳，此处改为
 * **确定性双端防护**：
 *   生成前：扫描全部已发布章节，建立「称谓→人名」锁表，注入铁律指令
 *   生成后：对候选正文做漂移检测，发现换名即触发重写
 *
 * 纯函数、零 LLM。首现即锁定（battle4 口径："首现后不得漂移"）。
 */

/** 亲缘称谓表（构建正则时先长后短，防"哥哥"被"哥"截胡） */
const KINSHIP_TERMS = [
  '父亲', '母亲', '哥哥', '姐姐', '弟弟', '妹妹', '爷爷', '奶奶',
  '叔叔', '伯伯', '舅舅', '姑姑', '婶婶', '儿子', '女儿', '妻子',
  '丈夫', '媳妇', '老婆', '爸爸', '妈妈', '爹', '娘', '爸', '妈',
  '哥', '姐', '弟', '妹',
];

/** 捕获到的"人名"若是这些词，判定为误抓（时间词/代词/常用连词） */
const NAME_STOPWORDS = new Set([
  '今天', '明天', '昨天', '当年', '后来', '现在', '以前', '从前',
  '他们', '我们', '她们', '自己', '什么', '没有', '不是', '就是',
  '家里', '家的', '早早', '刚才', '回来', '出去', '进去', '上来',
]);

function kinAlt(): string {
  return [...KINSHIP_TERMS].sort((a, b) => b.length - a.length).join('|');
}

const NAME = '([\\u4e00-\\u9fa5]{2,3})';

/** 绑定模式：正文里"称谓↔人名"的确定性建立方式（称谓与人名均为捕获组，顺序因模式而异） */
function bindingPatterns(): RegExp[] {
  const K = kinAlt();
  return [
    // A. 叙述式点名：我爹叫/名叫/叫做/名为/名字是/是 阮长贵 → (term, name)
    new RegExp(`我(?:的)?(${K})(?:名叫|叫做|名为|名字是|名字叫|叫|是)${NAME}`, 'g'),
    // B. 紧邻式：我爹阮长贵[，。！？；、]（停顿才认；"我爸的签名"无名间隔不命中）→ (term, name)
    new RegExp(`我(?:的)?(${K})${NAME}(?=[，。！？；、])`, 'g'),
    // C. 倒装式：阮长贵是我爹 → (name, term)
    new RegExp(`${NAME}是我(?:的)?(${K})`, 'g'),
    // D. 同位式：阮长贵——我的父亲 / 阮长贵，我的爹 → (name, term)
    new RegExp(`${NAME}[——，,]\\s*我(?:的)?(${K})(?=[，。！？；、的])`, 'g'),
  ];
}

export interface KinshipLock {
  /** 亲缘称谓（如 爹/父亲） */
  term: string;
  /** 首现锁定的人名 */
  name: string;
  /** 首现于第几份文本（章节序，1-based 传入方保证） */
  firstSeenAt: number;
}

export interface KinshipDrift {
  term: string;
  expected: string;
  found: string;
  snippet: string;
}

function isValidName(token: string): boolean {
  return !NAME_STOPWORDS.has(token);
}

/**
 * 扫描历史章节文本，建立锁表。texts 按章节升序传入；
 * 同一称谓首次绑定即锁定，后到的不同名不再覆盖（首现即定）。
 */
export function extractKinshipLocks(texts: string[]): KinshipLock[] {
  const locks = new Map<string, KinshipLock>();
  for (let i = 0; i < texts.length; i += 1) {
    for (const re of bindingPatterns()) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(texts[i])) !== null) {
        // 各模式里称谓与人名的捕获组顺序不同（A/B: term,name；C/D: name,term）。
        // 按类型解析：称谓组 = 命中称谓表的那个组；人名组 = 另一个通过停用词过滤的组。
        const groups = m.slice(1).filter((g): g is string => typeof g === 'string' && g.length > 0);
        const term = groups.find((g) => KINSHIP_TERMS.includes(g));
        const name = term !== undefined
          ? groups.find((g) => g !== term && isValidName(g))
          : undefined;
        if (!term || !name) continue;
        if (!locks.has(term)) {
          locks.set(term, { term, name, firstSeenAt: i + 1 });
        }
      }
    }
  }
  return [...locks.values()];
}

/** 生成前注入的铁律文本（无锁时返回空串） */
export function formatKinshipLocks(locks: KinshipLock[]): string {
  if (locks.length === 0) return '';
  const lines = locks.map((l) => `- ${l.term}＝${l.name}（首现于第 ${l.firstSeenAt} 章附近）`);
  return [
    '【亲缘人名锁定（铁律）】',
    ...lines,
    '以上称谓只能指这个人、只用这个名。本章提及该亲属必须用锁定名，'
    + '严禁出现别名、新名或张冠李戴；若剧情确需"另一个人"，必须换称谓表述。',
  ].join('\n');
}

/**
 * 漂移检测：新文本里锁定的称谓绑到了不同的名字 → 违例。
 * 只报确定性命中（与绑定模式同口径），同名提及不报。
 */
export function detectKinshipDrift(text: string, locks: KinshipLock[]): KinshipDrift[] {
  const drifts: KinshipDrift[] = [];
  for (const lock of locks) {
    const K = lock.term;
    const pats = [
      new RegExp(`我(?:的)?(${K})(?:名叫|叫做|名为|名字是|名字叫|叫|是)${NAME}`, 'g'),
      new RegExp(`我(?:的)?(${K})${NAME}(?=[，。！？；、])`, 'g'),
      new RegExp(`${NAME}是我(?:的)?(${K})`, 'g'),
      new RegExp(`${NAME}[——，,]\\s*我(?:的)?(${K})(?=[，。！？；、的])`, 'g'),
    ];
    for (const re of pats) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const groups = m.slice(1);
        const found = groups.find((g) => isValidName(g ?? '') && g !== lock.term) ?? '';
        if (found && found !== lock.name) {
          const at = m.index;
          const snippet = text.slice(Math.max(0, at - 10), at + m[0].length + 10);
          drifts.push({ term: lock.term, expected: lock.name, found, snippet });
        }
      }
    }
  }
  return drifts;
}
