import { fail, isRecord, type ParseResult } from './parse.ts';

export interface GenerateChaptersRequest {
  from: number;
  to: number;
  qualityGate?: boolean;
  maxRevise?: number;
  engineName?: string;
  model?: string;
  wordCount?: number;
  maxCostRmb?: number;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export function parseGenerateChaptersRequest(raw: unknown): ParseResult<GenerateChaptersRequest> {
  if (!isRecord(raw)) return fail('生成请求体必须是对象');

  if (!isPositiveInt(raw.from) || !isPositiveInt(raw.to)) {
    return fail('from/to 必须是 ≥ 1 的整数');
  }
  if (raw.from > raw.to) {
    return fail('from 不能大于 to');
  }

  const data: GenerateChaptersRequest = {
    from: raw.from,
    to: raw.to,
  };

  if (typeof raw.qualityGate === 'boolean') data.qualityGate = raw.qualityGate;
  if (typeof raw.maxRevise === 'number' && Number.isFinite(raw.maxRevise)) {
    data.maxRevise = raw.maxRevise;
  }
  if (typeof raw.engineName === 'string') data.engineName = raw.engineName;
  if (typeof raw.model === 'string') data.model = raw.model;
  if (typeof raw.wordCount === 'number' && Number.isFinite(raw.wordCount)) {
    data.wordCount = raw.wordCount;
  }
  if (typeof raw.maxCostRmb === 'number' && Number.isFinite(raw.maxCostRmb)) {
    data.maxCostRmb = raw.maxCostRmb;
  }

  return { ok: true, data };
}
