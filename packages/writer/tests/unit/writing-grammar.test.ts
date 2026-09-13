/**
 * 写作引擎：豆瓣换底座，番茄/盐选/通用保持留存语法。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseTargetPlatform } from '../../src/project.ts';
import {
  blueprintChapterRules,
  blueprintEndingHookJsonField,
  chapterWritingDirectives,
  formatEndingInstruction,
  getPlatformGuidelines,
  rewriteIntro,
  rewritePaceRules,
  writingEngineFor,
} from '../../src/chapter/writing-grammar.ts';

describe('writingEngineFor', () => {
  it('只有豆瓣走文学引擎', () => {
    assert.equal(writingEngineFor('douban'), 'literary');
    assert.equal(writingEngineFor('general'), 'retention');
    assert.equal(writingEngineFor('fanqie'), 'retention');
    assert.equal(writingEngineFor('yanxuan'), 'retention');
  });
});

describe('chapterWritingDirectives', () => {
  it('番茄后续章仍要求 500 字转折和生死钩子', () => {
    const text = chapterWritingDirectives('fanqie', 2).join('\n');
    assert.match(text, /每 500 字至少一个小转折/);
    assert.match(text, /章末生死断点钩子/);
    assert.equal(text.includes('生活流'), false);
  });

  it('豆瓣替换底座：不要 500 字转折，不要生死钩子', () => {
    const text = chapterWritingDirectives('douban', 2).join('\n');
    assert.match(text, /替换网文留存语法/);
    assert.match(text, /不要每 500 字强行制造转折/);
    assert.match(text, /禁止每章都用危机/);
    assert.equal(text.includes('章末生死断点钩子'), false);
    assert.equal(text.includes('每 500 字至少一个小转折'), false);
  });

  it('通用仍是网文钩子，不吃豆瓣规则', () => {
    const text = chapterWritingDirectives('general', 1).join('\n');
    assert.match(text, /畅销网文通用规范/);
    assert.match(text, /悬念钩子/);
    assert.equal(text.includes('替换网文留存语法'), false);
  });
});

describe('blueprint + ending instruction', () => {
  it('留存蓝图仍强制生死钩子', () => {
    const rules = blueprintChapterRules('fanqie');
    assert.match(rules, /章末强断点钩子/);
    assert.match(rules, /生死留存钩子/);
    assert.match(getPlatformGuidelines('fanqie'), /断点钩子/);
  });

  it('豆瓣蓝图允许安静收束且钩子可空', () => {
    const rules = blueprintChapterRules('douban');
    assert.match(rules, /ending_hook，可空/);
    assert.match(rules, /禁止每章都用同一套/);
    assert.equal(rules.includes('生死留存钩子'), false);
    assert.match(getPlatformGuidelines('douban'), /禁止每章生死留存钩子/);
  });

  it('有 endingHook 时豆瓣不叫断点钩子', () => {
    assert.match(
      formatEndingInstruction('fanqie', '他推开门'),
      /章末断点钩子/,
    );
    const literary = formatEndingInstruction('douban', '他推开门');
    assert.match(literary, /本章收束/);
    assert.equal(literary.includes('断点钩子'), false);
    assert.equal(formatEndingInstruction('douban', ''), '');
  });

  it('蓝图 JSON 示例按引擎换 ending_hook 示范', () => {
    assert.match(blueprintEndingHookJsonField('fanqie'), /章末强悬念钩子/);
    assert.match(blueprintEndingHookJsonField('douban'), /可空，允许安静落地/);
    assert.equal(blueprintEndingHookJsonField('douban').includes('强悬念钩子'), false);
  });
});

describe('rewrite prompts', () => {
  it('留存重写仍对准番茄读者', () => {
    assert.match(rewriteIntro('general'), /番茄小说的用户/);
    assert.match(rewritePaceRules('yanxuan'), /每 500 字至少一个小转折/);
  });

  it('豆瓣重写禁止把安静收束改成钩子', () => {
    assert.match(rewriteIntro('douban'), /不要改成章末吊胃口/);
    assert.equal(rewriteIntro('douban').includes('番茄小说的用户'), false);
    assert.match(rewritePaceRules('douban'), /禁止为留存而每 500 字强行转折/);
  });
});

describe('parseTargetPlatform', () => {
  it('接受四平台并拒绝未知值', () => {
    assert.equal(parseTargetPlatform('douban'), 'douban');
    assert.throws(() => parseTargetPlatform('zhihu'), /未知平台/);
  });
});
