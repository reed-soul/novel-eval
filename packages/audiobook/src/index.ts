export { annotateChapter, DEFAULT_VOICE_CONFIG } from './annotate.ts';
export type { Segment, SegmentKind, VoiceConfig } from './annotate.ts';
export { openWriterDb, loadChapters, listProjects, resolveProjectId } from './db.ts';
export { createEngine } from './tts/index.ts';
export type { TtsEngine, SynthResult } from './tts/index.ts';
export { assembleChapter } from './audio.ts';
export { renderChapterVideo } from './video.ts';
export {
  buildUploadPlan,
  writeUploadBundle,
  buildYouTubePlaylistMaterial,
  formatYouTubeTitle,
  DEFAULT_BRAND,
  DEFAULT_HASHTAGS,
  type PlaylistMaterial,
  type ChapterUploadPlan,
} from './youtube.ts';
export {
  loadRegistry, saveRegistry, setupBookLine, recordEpisode, nextEpisodeHint, episodeReady,
} from './registry.ts';
export type { BookRegistry, EpisodeRecord, Registry } from './registry.ts';
