import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSlots, assignSegments, buildSegmentArgs } from '../../src/video.ts';
import { buildUploadPlan, DEFAULT_BRAND } from '../../src/youtube.ts';

const FPS = 24;

test('planSlots：雪花锁相——所有切点都落在雪花周期整数倍上', () => {
  const L = 10; // 雪花周期 10s
  for (const dur of [13, 45.7, 100, 233.33, 900]) {
    const slots = planSlots(dur, L);
    let acc = 0;
    for (let i = 0; i < slots.length - 1; i++) { // 末段边界是片尾，不是切点
      acc += slots[i].durS;
      if (acc < 25.01) {
        // 25s 甜区内出现的切点必须严格对齐周期
        assert.ok(Math.abs(acc % L) < 0.011 || Math.abs(L - (acc % L)) < 0.011, `dur=${dur} 切点 ${acc} 未锁相`);
      }
    }
  }
});

test('planSlots：标准桶 = 周期最大整数倍且 ≤25s；尾段独立成段', () => {
  const slots = planSlots(95, 10); // 900/24=39.6→ceil 帧…总时长 95s：4×20 + 15
  assert.equal(slots.filter((s) => s.durS === 20).length, 4);
  assert.equal(slots[slots.length - 1].durS, 15);
});

test('planSlots：总时长按帧栅格向上取整（视频 ≥ 音频，-shortest 以音频收尾）', () => {
  for (const dur of [13.37, 60.001, 45.9999]) {
    const total = planSlots(dur, null).reduce((a, s) => a + s.durS, 0);
    assert.ok(total >= dur - 1e-6, `dur=${dur} 总长 ${total} < 音频`);
    assert.ok(total - dur < 1 / FPS + 1e-6, `dur=${dur} 超出一帧`);
  }
});

test('planSlots：无雪花时退化为 25s 标准桶', () => {
  const slots = planSlots(80, null);
  assert.equal(slots[0].durS, 25);
  assert.equal(slots.filter((s) => s.durS === 25).length, 3);
  assert.equal(slots.at(-1)!.durS, 5);
});

test('planSlots：尾段过短并入前段（不产生 <4s 的碎段）', () => {
  const slots = planSlots(63.5, 10);
  const tail = slots.at(-1)!.durS;
  assert.ok(tail >= 4, `尾段 ${tail} 过短`);
});

test('assignSegments：轮换分配 + 相邻同图合并（单图成一段）', () => {
  const slots = [{ durS: 20 }, { durS: 20 }, { durS: 20 }];
  const two = assignSegments(slots, ['/a.png', '/b.png']);
  assert.equal(two.length, 3);
  assert.deepEqual(two.map((s) => s.img), ['/a.png', '/b.png', '/a.png']);
  const one = assignSegments(slots, ['/a.png']);
  assert.equal(one.length, 1);
  assert.equal(one[0].durS, 60);
});

test('buildSegmentArgs：-stream_loop -1 必须与输出 -t 成对（防无限写盘）', () => {
  const args = buildSegmentArgs({ big: '/x.png', durS: 20, snow: '/s.mp4', snowOffsetS: 0, opacity: 0.35 });
  const loopAt = args.indexOf('-stream_loop');
  assert.notEqual(loopAt, -1);
  assert.equal(args[loopAt + 1], '-1');
  // 输出时限 -t 出现两次：一次输入 -t（loop 图），一次输出 -t（约束 stream_loop）
  assert.equal(args.filter((a) => a === '-t').length, 2);
  assert.equal(args.at(-1), '-an'); // 数组不含输出路径，由调用方追加（tmp 文件）
});

test('buildSegmentArgs：closed GOP + CRF18 + 亮度直混', () => {
  const args = buildSegmentArgs({ big: '/x.png', durS: 20, snow: '/s.mp4', opacity: 0.35 });
  const graph = args[args.indexOf('-filter_complex') + 1] as string;
  assert.match(graph, /blend=c0_mode=screen:c0_opacity=0\.35/);
  assert.doesNotMatch(graph, /gbrp/); // 不再走 RGB 平面往返
  assert.ok(args.includes('-flags') && args[args.indexOf('-flags') + 1] === '+cgop');
  assert.ok(args.includes('keyint_min') || args.includes('-keyint_min'));
  assert.ok(args.includes('-crf') && args[args.indexOf('-crf') + 1] === '18');
});

test('buildSegmentArgs：无雪花分支不含 blend/stream_loop', () => {
  const args = buildSegmentArgs({ big: '/x.png', durS: 20, opacity: 0.35 });
  assert.ok(!args.includes('-stream_loop'));
  const graph = args[args.indexOf('-filter_complex') + 1] as string;
  assert.doesNotMatch(graph, /blend/);
});

test('buildSegmentArgs：雪花非零相位用 trim（不用 -ss，防二次循环回文件头）', () => {
  const args = buildSegmentArgs({ big: '/x.png', durS: 5, snow: '/s.mp4', snowOffsetS: 4.5, opacity: 0.35 });
  const graph = args[args.indexOf('-filter_complex') + 1] as string;
  assert.match(graph, /trim=start=4\.500,setpts=PTS-STARTPTS/);
});

test('章节时间戳：≥3 条时进描述、首条 0:00、mm:ss 格式', () => {
  const plan = buildUploadPlan('测试书', [{
    position: 1, title: '第一章 试', audioFile: 'a.mp3', videoFile: 'a.mp4', durationMs: 900_000, srtFile: 'a.srt',
    chapters: [
      { startMs: 0, label: '冷开场' },
      { startMs: 15_000, label: '第一章 试' },
      { startMs: 500_000, label: '第二章 试' },
    ],
  }], DEFAULT_BRAND);
  const desc = plan[0].description;
  assert.match(desc, /0:00 冷开场/);
  assert.match(desc, /0:15 第一章 试/);
  assert.match(desc, /8:20 第二章 试/);
  assert.equal(plan[0].captions?.language, 'zh-Hans');
  assert.equal(plan[0].captions?.file, 'a.srt');
});

test('章节时间戳：不足 3 条不生成导航块（YouTube 章节规则）', () => {
  const plan = buildUploadPlan('测试书', [{
    position: 1, title: '试', audioFile: 'a.mp3', videoFile: 'a.mp4', durationMs: 60_000,
    chapters: [{ startMs: 0, label: '冷开场' }],
  }], DEFAULT_BRAND);
  assert.doesNotMatch(plan[0].description, /章节导航/);
});
