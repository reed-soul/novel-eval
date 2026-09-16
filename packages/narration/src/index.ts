export { generateScript, CHARS_PER_SEC, type ChapterInput, type ScriptOptions } from './script.ts';
export { structureGate, causalGate } from './gates.ts';
export { buildAudio, type AudioOptions, type AudioResult } from './audio.ts';
export { NEGATIVE_LEXICON } from './prompts.ts';
export {
  loadNarrationRegistry, setupNarrationLine, narrationRegistryPath,
  loadNarrationCost, appendNarrationCost, narrationCostSummary, estimateNarrationCost, NARRATION_UNIT_COST,
  type NarrationLine, type NarrationRegistry, type NarrationCostEntry, type NarrationCostSummary,
} from './registry.ts';
