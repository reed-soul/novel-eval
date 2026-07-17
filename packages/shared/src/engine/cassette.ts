/**
 * Prompt-hash cassette adapter — record / replay LLM CallResults without call-order indexing.
 *
 * Hash covers system + user prompt (+ model/temperature) so concurrent map/reduce is safe.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { TokenUsage } from '../types.ts';
import type { AIAgentAdapter, CallResult, RunOptions } from './interface.ts';

export type CassetteMode = 'record' | 'replay';

export interface CassetteRequestMeta {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
}

export interface CassetteEntry {
  version: 1;
  hash: string;
  recordedAt: string;
  request: CassetteRequestMeta;
  response: {
    text: string;
    usage: TokenUsage;
    notes: string[];
  };
}

export interface CassetteAdapterOptions {
  mode: CassetteMode;
  /** Directory holding `<hash>.json` cassette files. */
  directory: string;
  /** Required for `record`; unused for `replay`. */
  inner?: AIAgentAdapter;
  name?: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/** SHA-256 hex of the run inputs that determine model output for eval/writer. */
export function cassettePromptHash(userPrompt: string, options: RunOptions = {}): string {
  const payload = {
    systemPrompt: options.systemPrompt ?? '',
    userPrompt,
    model: options.model ?? null,
    temperature: options.temperature ?? null,
  };
  return createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

function cassettePath(directory: string, hash: string): string {
  return join(directory, `${hash}.json`);
}

function readCassette(path: string): CassetteEntry {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as CassetteEntry;
  if (raw.version !== 1 || typeof raw.hash !== 'string' || typeof raw.response?.text !== 'string') {
    throw new Error(`Invalid cassette file: ${path}`);
  }
  return raw;
}

function writeCassetteAtomic(path: string, entry: CassetteEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export class CassetteMissError extends Error {
  readonly hash: string;
  readonly directory: string;

  constructor(hash: string, directory: string, preview: string) {
    super(
      `Cassette miss (replay): hash=${hash.slice(0, 12)}… dir=${directory}`
      + (preview ? ` preview=${JSON.stringify(preview.slice(0, 120))}` : ''),
    );
    this.name = 'CassetteMissError';
    this.hash = hash;
    this.directory = directory;
  }
}

/**
 * Record: on miss call inner and persist; on hit return stored response.
 * Replay: on miss throw CassetteMissError; never calls network.
 */
export class CassetteAdapter implements AIAgentAdapter {
  readonly name: string;
  private readonly mode: CassetteMode;
  private readonly directory: string;
  private readonly inner: AIAgentAdapter | undefined;
  /** Deduplicate concurrent record misses for the same hash. */
  private readonly inflight = new Map<string, Promise<CallResult>>();

  constructor(options: CassetteAdapterOptions) {
    this.mode = options.mode;
    this.directory = options.directory;
    this.inner = options.inner;
    this.name = options.name
      ?? (options.mode === 'record'
        ? `cassette-record(${options.inner?.name ?? 'unknown'})`
        : 'cassette-replay');
    if (options.mode === 'record' && !options.inner) {
      throw new Error('CassetteAdapter record mode requires an inner AIAgentAdapter');
    }
    mkdirSync(this.directory, { recursive: true });
  }

  async isAvailable(): Promise<boolean> {
    if (this.mode === 'replay') return true;
    return this.inner ? this.inner.isAvailable() : false;
  }

  async run(userPrompt: string, options: RunOptions = {}): Promise<CallResult> {
    const hash = cassettePromptHash(userPrompt, options);
    const path = cassettePath(this.directory, hash);

    if (existsSync(path)) {
      return this.hitFromDisk(path, hash);
    }

    if (this.mode === 'replay') {
      throw new CassetteMissError(hash, this.directory, userPrompt);
    }

    const pending = this.inflight.get(hash);
    if (pending) {
      return pending;
    }

    const work = this.recordMiss(path, hash, userPrompt, options).finally(() => {
      this.inflight.delete(hash);
    });
    this.inflight.set(hash, work);
    return work;
  }

  private hitFromDisk(path: string, hash: string): CallResult {
    const entry = readCassette(path);
    return {
      text: entry.response.text,
      usage: entry.response.usage,
      notes: [...entry.response.notes, `cassette:hit:${hash.slice(0, 12)}`],
    };
  }

  private async recordMiss(
    path: string,
    hash: string,
    userPrompt: string,
    options: RunOptions,
  ): Promise<CallResult> {
    // Another writer may have finished while we waited on the queue.
    if (existsSync(path)) {
      return this.hitFromDisk(path, hash);
    }

    const inner = this.inner;
    if (!inner) {
      throw new Error('CassetteAdapter record mode missing inner adapter');
    }
    const result = await inner.run(userPrompt, options);
    const entry: CassetteEntry = {
      version: 1,
      hash,
      recordedAt: new Date().toISOString(),
      request: {
        systemPrompt: options.systemPrompt ?? '',
        userPrompt,
        model: options.model,
        temperature: options.temperature,
      },
      response: {
        text: result.text,
        usage: result.usage,
        notes: result.notes,
      },
    };
    writeCassetteAtomic(path, entry);
    return {
      text: result.text,
      usage: result.usage,
      notes: [...result.notes, `cassette:record:${hash.slice(0, 12)}`],
    };
  }
}
