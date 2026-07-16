type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type ProjectId = Brand<string, 'ProjectId'>;
export type OutlineId = Brand<string, 'OutlineId'>;
export type ChapterId = Brand<string, 'ChapterId'>;
export type ChapterRevisionId = Brand<string, 'ChapterRevisionId'>;
export type StoryStateRevisionId = Brand<string, 'StoryStateRevisionId'>;
export type CharacterId = Brand<string, 'CharacterId'>;
export type ForeshadowId = Brand<string, 'ForeshadowId'>;

function nonEmptyId<Name extends string>(value: string, name: Name): Brand<string, Name> {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
  return value as Brand<string, Name>;
}

export const projectId = (value: string): ProjectId => nonEmptyId(value, 'ProjectId');
export const outlineId = (value: string): OutlineId => nonEmptyId(value, 'OutlineId');
export const chapterId = (value: string): ChapterId => nonEmptyId(value, 'ChapterId');
export const chapterRevisionId = (value: string): ChapterRevisionId =>
  nonEmptyId(value, 'ChapterRevisionId');
export const storyStateRevisionId = (value: string): StoryStateRevisionId =>
  nonEmptyId(value, 'StoryStateRevisionId');
export const characterId = (value: string): CharacterId => nonEmptyId(value, 'CharacterId');
export const foreshadowId = (value: string): ForeshadowId => nonEmptyId(value, 'ForeshadowId');
