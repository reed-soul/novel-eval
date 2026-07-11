/**
 * JSON 容错解析（spike 用，对齐设计文档「JSON Schema 校验失败→重试」前置的解析层）
 *
 * 背景（spike 实测发现）：glm-5.2 生成中文内容时，常在 JSON 字符串值内
 * 用未转义的 ASCII 双引号包裹对话（如 summary: "他说"再见"就走了"），
 * 破坏 JSON 结构。这是中文 LLM JSON 输出的经典问题。
 *
 * 策略（按优先级逐级尝试）：
 *   1. 直接 JSON.parse
 *   2. 去 markdown 包裹后 parse
 *   3. 提取首个 {...} 后 parse
 *   4. 修复字符串值内未转义引号后 parse（核心修复）
 *   5. 上述都失败 → 抛错，触发上层重试
 */

export function parseJSONRobust(text: string): unknown {
  const errors: string[] = [];

  // 1. 直接 parse
  try {
    return JSON.parse(text);
  } catch (e) {
    errors.push(`直接parse: ${(e as Error).message.slice(0, 80)}`);
  }

  // 2. 去 markdown 代码块包裹
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (stripped !== text.trim()) {
    try {
      return JSON.parse(stripped);
    } catch (e) {
      errors.push(`去markdown: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  // 3. 提取首个 {...}
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = stripped.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch (e) {
      errors.push(`提取对象: ${(e as Error).message.slice(0, 80)}`);
    }

    // 4. 修复未转义引号后重试
    try {
      const fixed = fixUnescapedQuotes(slice);
      if (fixed !== slice) {
        return JSON.parse(fixed);
      }
    } catch (e) {
      errors.push(`修引号: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  throw new Error(`JSON 解析失败（已尝试 ${errors.length} 种策略）: ${errors.join(' | ')}`);
}

/**
 * 修复 JSON 字符串值内未转义的双引号。
 *
 * 思路：逐字符扫描，跟踪是否在字符串内部。
 * 在字符串内部遇到的双引号，若其后跟的不是 JSON 结构字符（, } : ] 等），
 * 判定为内容引号，转义为 \"。
 *
 * 这是个启发式修复，不保证 100% 正确，但能处理 LLM 常见的
 * "value": "他说"再见"" 这类情况。
 */
function fixUnescapedQuotes(json: string): string {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];

    if (escape) {
      result += ch;
      escape = false;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {
      if (!inString) {
        // 进入字符串
        inString = true;
        result += ch;
      } else {
        // 在字符串内遇到引号：判断是"字符串结束"还是"内容中的未转义引号"
        // 看后面（跳过空白）是不是 JSON 结构字符
        const nextNonSpace = json.slice(i + 1).match(/\S/);
        const nextCh = nextNonSpace?.[0];
        if (nextCh === ',' || nextCh === '}' || nextCh === ']' || nextCh === ':') {
          // 看起来是字符串结束
          inString = false;
          result += ch;
        } else {
          // 内容里的引号，转义它
          result += '\\"';
        }
      }
    } else {
      result += ch;
    }
  }

  return result;
}
