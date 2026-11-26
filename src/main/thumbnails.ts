import { app } from 'electron'
import { createHash } from 'crypto'
import { mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import sharp from 'sharp'
import ffmpegStatic from 'ffmpeg-static'
import { getDb } from './db'
import type { ThumbProgress, ThumbResult } from '../shared/types'

const execFileAsync = promisify(execFile)
const THUMB_WIDTH = 360
const CONCURRENCY = 3

let overrideDir: string | null = null

export function setThumbsDir(dir: string): void {
  overrideDir = dir
}

export function getThumbsDir(): string {
  const dir = overrideDir ?? join(app.getPath('userData'), 'thumbs')
  mkdirSync(dir, { recursive: true })
  return dir
}

function thumbName(nasPath: string): string {
  return createHash('sha1').update(nasPath).digest('hex') + '.jpg'
}

interface ThumbRow {
  path: string
  type: 'video' | 'photo'
  lrf_path: string | null
  thumb: string | null
}

function valid(file: string): boolean {
  try {
    return statSync(file).size > 500
  } catch {
    return false
  }
}

async function extractFrame(source: string, out: string, seek: string): Promise<boolean> {
  const ffmpeg = ffmpegStatic as unknown as string
  if (!ffmpeg) throw new Error('ffmpeg-static 未就绪')
  await execFileAsync(
    ffmpeg,
    [
      '-hide_banner', '-loglevel', 'error',
      '-ss', seek, '-i', source,
      '-frames:v', '1',
      '-vf', `scale=${THUMB_WIDTH}:-2`,
      '-q:v', '4', '-y', out
    ],
    { timeout: 25000, windowsHide: true, maxBuffer: 1024 * 1024 }
  )
  return valid(out)
}

async function generateOne(row: ThumbRow): Promise<'ok' | 'skip' | 'fail'> {
  const name = thumbName(row.path)
  const out = join(getThumbsDir(), name)
  if (valid(out)) {
    if (row.thumb !== name) {
      getDb().prepare('UPDATE files SET thumb = ? WHERE path = ?').run(name, row.path)
    }
    return 'skip'
  }

  const source = row.type === 'video' ? (row.lrf_path ?? row.path) : row.path
  try {
    if (row.type === 'photo') {
      await sharp(source)
        .rotate()
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toFile(out)
    } else {
      // 极短视频在 -ss 1 处无帧（ffmpeg 仍返回 0 但输出空文件），回退首帧
      let framed = false
      try {
        framed = await extractFrame(source, out, '1')
      } catch {
        framed = false
      }
      if (!framed) framed = await extractFrame(source, out, '0')
      if (!framed) return 'fail'
    }
    if (!valid(out)) return 'fail'
    getDb().prepare('UPDATE files SET thumb = ? WHERE path = ?').run(name, row.path)
    return 'ok'
  } catch {
    return 'fail'
  }
}

export async function generateAllThumbs(
  onProgress?: (p: ThumbProgress) => void
): Promise<ThumbResult> {
  const started = Date.now()
  const rows = getDb()
    .prepare('SELECT path, type, lrf_path, thumb FROM files')
    .all() as ThumbRow[]
  const dir = getThumbsDir()
  const pending = rows.filter((r) => !r.thumb || !valid(join(dir, r.thumb)))

  const queue = [...pending]
  const state: ThumbProgress = { done: 0, total: pending.length, succeeded: 0, failed: 0 }

  const worker = async () => {
    while (queue.length > 0) {
      const row = queue.shift()
      if (!row) break
      const r = await generateOne(row)
      if (r === 'fail') state.failed++
      else state.succeeded++
      state.done++
      onProgress?.({ ...state })
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return { ...state, elapsedMs: Date.now() - started }
}
