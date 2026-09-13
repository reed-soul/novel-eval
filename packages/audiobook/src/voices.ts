/**
 * 音色目录（M1 书级配置中心用）：voice 取值域 = DEFAULT_VOICE_CONFIG ∪ 火山 VOICE_MAP 键。
 * canonical 名沿用 edge 音色名；volcengine 侧经 VOICE_MAP 映射，未命中回落旁白。
 * 人话描述供 Web 配置 UI 下拉展示。
 */
export interface VoiceOption {
  voice: string;
  label: string; // 人话描述（选角参考）
}

export const VOICE_CATALOG: VoiceOption[] = [
  { voice: 'zh-CN-YunjianNeural', label: '云健 · 低沉男声（旁白首选）' },
  { voice: 'zh-CN-YunxiNeural', label: '云希 · 清爽男声（默认对白/男主）' },
  { voice: 'zh-CN-YunyangNeural', label: '云扬 · 中年男（领导/长辈）' },
  { voice: 'zh-CN-YunyeNeural', label: '云野 · 沉郁老者（曾间歇下线，慎选）' },
  { voice: 'zh-CN-YunzeNeural', label: '云泽 · 年轻男配' },
  { voice: 'zh-CN-YunxiaNeural', label: '云夏 · 少年' },
  { voice: 'zh-CN-XiaoyiNeural', label: '晓伊 · 知性女声（女主）' },
  { voice: 'zh-CN-XiaomoNeural', label: '晓墨 · 泼辣直率女性' },
  { voice: 'zh-CN-XiaohanNeural', label: '晓涵 · 温柔女性（曾间歇下线，慎选）' },
  { voice: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 儿童' },
];
