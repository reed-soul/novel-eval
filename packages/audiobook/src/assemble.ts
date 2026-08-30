/**
 * L3 组装：段文件 concat demuxer -c copy 零重编拼接 + 全长音频/字幕一次挂载，
 * 原子写出成片（.tmp → ffprobe 校验 → rename）。
 * 安全约束：spawn 走数组参数（shell:false）；清单条目落盘前校验必须落在段缓存目录内。
 */
import { writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { ffmpeg } from './ffmpeg.ts';
import { promote } from './render-assets.ts';

const REPO_ROOT = process.cwd();

export interface AssembleOpts {
  files: string[];
  segDir: string;
  cacheRoot: string;
  audio: string;
  subs?: string;
  out: string;
}

export async function assembleEpisodeVideo(o: AssembleOpts): Promise<void> {
  const root = REPO_ROOT + sep;
  const segDir = resolve(REPO_ROOT, o.segDir);
  if (!segDir.startsWith(root) || segDir.includes('..')) throw new Error('路径越界（仅允许仓库内）：' + o.segDir);
  const cacheRoot = resolve(REPO_ROOT, o.cacheRoot);
  if (!cacheRoot.startsWith(root) || cacheRoot.includes('..')) throw new Error('路径越界（仅允许仓库内）：' + o.cacheRoot);
  const audio = resolve(REPO_ROOT, o.audio);
  if (!audio.startsWith(root) || audio.includes('..')) throw new Error('路径越界（仅允许仓库内）：' + o.audio);
  const out = resolve(REPO_ROOT, o.out);
  if (!out.startsWith(root) || out.includes('..')) throw new Error('路径越界（仅允许仓库内）：' + o.out);
  const subs = o.subs ? resolve(REPO_ROOT, o.subs) : undefined;
  if (subs && (!subs.startsWith(root) || subs.includes('..'))) throw new Error('路径越界（仅允许仓库内）：' + o.subs);

  // 清单条目落盘前校验：段文件必须都在段缓存目录内（防路径注入 concat 清单）
  const segDirAbs = segDir + sep;
  const items: string[] = [];
  for (const f of o.files) {
    const rf = resolve(REPO_ROOT, f);
    if (!rf.startsWith(segDirAbs)) throw new Error('concat 清单条目越界：' + f);
    items.push("file '" + rf.replaceAll("'", "'\\''") + "'"); // concat 清单内嵌套 ' 须转义为 '\''
  }
  const listFile = join(cacheRoot, 'concat.list');
  await writeFile(listFile, items.join('\n'), 'utf-8');

  const outTmp = join(dirname(out), basename(out, '.mp4') + '.tmp.mp4');
  await ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-i', audio,
    ...(subs ? ['-i', subs] : []),
    '-map', '0:v', '-map', '1:a',
    ...(subs ? ['-map', '2:s', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=chi'] : []),
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
    '-shortest',
    ...(process.env.AUDIOBOOK_NO_FASTSTART === '1' ? [] : ['-movflags', '+faststart']),
    outTmp,
  ]);
  await promote(outTmp, out);
}
