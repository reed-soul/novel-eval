/**
 * 分章正则单测（对齐设计文档第三章「策略2 正则匹配」）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitChapters, splitChaptersWithMeta, countChars, inferKind } from '../../src/chapter/chapter-splitter.ts';

describe('splitChapters', () => {
  it('匹配"第X章"模式', () => {
    const text = '第一章 归乡\n\n内容一\n\n第二章 旧人\n\n内容二';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0].id, 'ch001');
    assert.equal(chapters[0].title, '第一章 归乡');
    assert.equal(chapters[0].content, '内容一');
    assert.equal(chapters[1].title, '第二章 旧人');
    assert.equal(chapters[1].content, '内容二');
  });

  it('匹配"第X回"模式', () => {
    const text = '第一回 宴桃园\n内容\n第二回 怒鞭督邮\n内容二';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0].title, '第一回 宴桃园');
  });

  it('匹配"第X节"模式', () => {
    const text = '第一节 开端\n内容\n第二节 发展\n内容';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 2);
  });

  it('匹配"第X卷"模式', () => {
    const text = '第一卷 风起\n内容\n第二卷 云涌\n内容';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 2);
  });

  it('匹配数字章节（第3章）', () => {
    const text = '第3章 标题\n内容\n第4章 标题\n内容';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 2);
  });

  it('匹配大写数字（第十章/第十二章）', () => {
    const text = '第十章 标题\n内容\n第十二章 标题\n内容';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 2);
  });

  it('无章节标志时回退为单章', () => {
    const text = '这是一段没有章节标志的纯文本内容。';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 1);
    assert.equal(chapters[0].title, '全文');
    assert.equal(chapters[0].content, '这是一段没有章节标志的纯文本内容。');
  });

  it('章节 id 补零到3位（ch001-ch999）', () => {
    let text = '';
    for (let i = 1; i <= 12; i++) {
      text += `第${'一二三四五六七八九十十一十二'[i - 1]}章 标题${i}\n内容${i}\n`;
    }
    const chapters = splitChapters(text);
    assert.equal(chapters[0].id, 'ch001');
    assert.equal(chapters[11].id, 'ch012');
  });

  it('正文含"第X章"样式的句子但不在行首时不误匹配', () => {
    // "第3章" 在句中（前面有文字），不应被当作章节标题
    const text = '他说这是第3章的内容。\n正文继续';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 1);  // 不该被切分
  });

  it('空内容章节仍保留（标题后直接下一章）', () => {
    const text = '第一章 空\n\n第二章 有内容\n内容二';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0].content, '');
    assert.equal(chapters[1].content, '内容二');
  });

  it('trim 首尾空白', () => {
    const text = '  \n第一章 标题\n  内容  \n第二章 标题二\n内容二  \n  ';
    const chapters = splitChapters(text);
    assert.equal(chapters[0].content, '内容');
    assert.equal(chapters[1].content, '内容二');
  });

  // ─── v2.3 新增：多策略探测 ───────────────────────────────

  it('CRLF 换行归一化（长夜难明模式）', () => {
    const text = '第一章\r\n内容一\r\n第二章\r\n内容二';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0].title, '第一章');
    assert.equal(chapters[0].content, '内容一');
    assert.equal(chapters[1].content, '内容二');
  });

  it('分隔符块模式（诛仙/长安模式）', () => {
    const text = '========================================\n第一章 归乡\n========================================\n正文一\n========================================\n第二章 旧人\n========================================\n正文二\n========================================\n第三章 决定\n========================================\n正文三';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 3);
    assert.equal(chapters[0].title, '第一章 归乡');
    assert.equal(chapters[0].content, '正文一');
    assert.equal(chapters[2].title, '第三章 决定');
    assert.equal(chapters[2].content, '正文三');
  });

  it('分隔符块：正文里的后缀标题行不重复计入', () => {
    // 模拟长安/夜的命名术：块外有「标题-《书名》」后缀行，不应被重复切
    const text = '========================================\n第一章 A\n========================================\n第一章 A-《书名》\n正文一\n========================================\n第二章 B\n========================================\n第二章 B-《书名》\n正文二\n========================================\n第三章 C\n========================================\n正文三';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 3);  // 不是 6
    assert.equal(chapters[0].title, '第一章 A');
  });

  it('阿拉伯数字编号（夜的命名术模式）', () => {
    const text = '1、想等的人\n正文一\n2、倒计时\n正文二\n3、破碎的世界\n正文三';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 3);
    assert.equal(chapters[0].title, '1、想等的人');
    assert.equal(chapters[1].title, '2、倒计时');
  });

  it('中文组合数字（第二十一章/第三十章）', () => {
    const text = '第二十一章 高潮\n正文一\n第三十章 结局\n正文二';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0].title, '第二十一章 高潮');
    assert.equal(chapters[1].title, '第三十章 结局');
  });

  it('Chapter N 英文章节标题', () => {
    const text = 'Chapter 1 Beginning\ncontent one\nChapter 2 Middle\ncontent two';
    const chapters = splitChapters(text);
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0].title, 'Chapter 1 Beginning');
  });
});

describe('splitChaptersWithMeta', () => {
  it('分隔符块返回 strategy=separator, confidence=high', () => {
    const text = '=====\n第一章 A\n=====\n正文一\n=====\n第二章 B\n=====\n正文二\n=====\n第三章 C\n=====\n正文三';
    const r = splitChaptersWithMeta(text);
    assert.equal(r.strategy, 'separator');
    assert.equal(r.confidence, 'high');
    assert.equal(r.chapters.length, 3);
    assert.ok(r.sampleTitles.length > 0);
  });

  it('行首正则返回 strategy=regex, confidence=high', () => {
    const text = '第一章 A\n正文\n第二章 B\n正文';
    const r = splitChaptersWithMeta(text);
    assert.equal(r.strategy, 'regex');
    assert.equal(r.confidence, 'high');
    assert.equal(r.sampleTitles[0], '第一章 A');
  });

  it('无标志回退返回 strategy=fallback, confidence=low', () => {
    const text = '这是一段没有任何章节标志的纯文本内容，只有连续的段落。';
    const r = splitChaptersWithMeta(text);
    assert.equal(r.strategy, 'fallback');
    assert.equal(r.confidence, 'low');
    assert.equal(r.chapters.length, 1);
    assert.equal(r.sampleTitles.length, 0);
  });

  it('仅 1 个正则命中但文本超长 → confidence=low（触发 AI 确认）', () => {
    const long = '第一章 唯一\n' + '正文内容'.repeat(20000);
    const r = splitChaptersWithMeta(long);
    assert.equal(r.confidence, 'low');
  });
});

describe('countChars', () => {
  it('计非空白字符数（中文按字符计）', () => {
    assert.equal(countChars('你好世界'), 4);
    assert.equal(countChars('  hello  world  '), 10);
    assert.equal(countChars(''), 0);
  });
});

describe('inferKind', () => {
  it('楔子/序/引子判为 prologue', () => {
    assert.equal(inferKind('楔子'), 'prologue');
    assert.equal(inferKind('序章 故事开始'), 'prologue');
    assert.equal(inferKind('引子'), 'prologue');
  });

  it('尾声/后记/跋判为 epilogue', () => {
    assert.equal(inferKind('尾声'), 'epilogue');
    assert.equal(inferKind('后记'), 'epilogue');
    assert.equal(inferKind('跋'), 'epilogue');
  });

  it('番外/外篇判为 extra', () => {
    assert.equal(inferKind('番外 那些年'), 'extra');
    assert.equal(inferKind('外篇 角色A的故事'), 'extra');
  });

  it('其他判为 main', () => {
    assert.equal(inferKind('第一章 开始'), 'main');
    assert.equal(inferKind('第五回 高潮'), 'main');
  });
});
