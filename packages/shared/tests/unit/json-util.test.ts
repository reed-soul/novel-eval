/**
 * JSON 容错解析单测（对齐设计文档 v2.2 10.6）
 *
 * spike 发现：glm-5.2 在中文摘要里用未转义 ASCII 双引号包裹对话，
 * 破坏 JSON。parseJSONRobust 必须能修复这类情况。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseJSONRobust } from '../../src/engine/json-util.ts';

describe('parseJSONRobust', () => {
  it('正常 JSON 直接解析', () => {
    const result = parseJSONRobust('{"name":"测试","value":42}') as Record<string, unknown>;
    assert.equal(result.name, '测试');
    assert.equal(result.value, 42);
  });

  it('去 markdown 代码块包裹', () => {
    const result = parseJSONRobust('```json\n{"name":"测试"}\n```') as Record<string, unknown>;
    assert.equal(result.name, '测试');
  });

  it('去无语言标记的代码块', () => {
    const result = parseJSONRobust('```\n{"x":1}\n```') as Record<string, unknown>;
    assert.equal(result.x, 1);
  });

  it('提取首个 JSON 对象（前后有杂文字）', () => {
    const result = parseJSONRobust('好的，以下是结果：\n{"summary":"章节梗概"}\n结束') as Record<string, unknown>;
    assert.equal(result.summary, '章节梗概');
  });

  it('修复字符串值内未转义的双引号（spike 发现的核心问题）', () => {
    // glm-5.2 常见输出：summary 值里有 "再说吧" 用了未转义 ASCII 引号
    const broken = '{"summary":"林晚说"再说吧"就走了","tension":55}';
    const result = parseJSONRobust(broken) as Record<string, unknown>;
    assert.equal(result.tension, 55);
    assert.ok(typeof result.summary === 'string');
    assert.ok((result.summary as string).includes('再说吧'));
  });

  it('修复多个未转义引号', () => {
    const broken = '{"a":"他说"你好"然后走了","b":"她说"再见""}';
    const result = parseJSONRobust(broken) as Record<string, unknown>;
    assert.ok(typeof result.a === 'string');
    assert.ok(typeof result.b === 'string');
  });

  it('完整抛错：无法解析的非 JSON 文本', () => {
    assert.throws(() => parseJSONRobust('这根本不是 JSON'));
  });

  it('空对象', () => {
    const result = parseJSONRobust('{}') as Record<string, unknown>;
    assert.deepEqual(result, {});
  });

  it('嵌套对象 + 数组', () => {
    const json = '{"dimensions":{"story":{"score":72,"quotes":["a","b"]}}}';
    const result = parseJSONRobust(json) as { dimensions: { story: { score: number; quotes: string[] } } };
    assert.equal(result.dimensions.story.score, 72);
    assert.deepEqual(result.dimensions.story.quotes, ['a', 'b']);
  });

  it('中文内容（含全角标点）正常解析', () => {
    const json = '{"summary":"陈默回到故乡，看见母亲择豆角。","tension":28}';
    const result = parseJSONRobust(json) as Record<string, unknown>;
    assert.equal(result.summary, '陈默回到故乡，看见母亲择豆角。');
  });
});
