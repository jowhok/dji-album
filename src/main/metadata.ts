import { existsSync, statSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import sharp from 'sharp'
import ffmpegStatic from 'ffmpeg-static'
import { parseProbeOutput, EMPTY_PROBE } from './probe-parser'
import { getDb } from './db'
import type { MediaMeta, MetaProgress, MetaResult, ProbeFields } from '../shared/types'

export { parseProbeOutput } from './probe-parser'

const execFileAsync = promisify(execFile)
const CONCURRENCY = 3
const TIMEOUT = 30000


async function runFfmpeg(file: string): Promise<string> {
  const ffmpeg = ffmpegStatic as unknown as string
  if (!ffmpeg) throw new Error('ffmpeg-static 未就绪')
  try {
    const { stderr } = await execFileAsync(ffmpeg, ['-hide_banner', '-i', file], {
      timeout: TIMEOUT,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    })
    return String(stderr ?? '')
  } catch (e) {
    // ffmpeg -i 无输出文件时返回码非 0，但 stderr 已含完整元数据
    const stderr = String((e as { stderr?: string }).stderr ?? '')
    if (stderr.includes('Duration:')) return stderr
    throw e
  }
}

async function probeVideo(
  mp4: string,
  lrf: string | null
): Promise<{ fields: ProbeFields; src: string }> {
  try {
    const fields = parseProbeOutput(await runFfmpeg(mp4))
    if (fields.duration != null) return { fields, src: 'mp4' }
  } catch {
    // 原片读取失败时回退代理文件
  }
  if (lrf) {
    try {
      const fields = parseProbeOutput(await runFfmpeg(lrf))
      if (fields.duration != null) {
        // LRF 是低码率代理，分辨率/码率不代表原片，只保留时长与帧率
        return {
          fields: { ...fields, width: null, height: null, bitrate: null, vcodec: null, acodec: null },
          src: 'lrf'
        }
      }
    } catch {
      // 交给调用方标记失败
    }
  }
  throw new Error('无法读取视频元数据')
}

async function probePhoto(path: string): Promise<ProbeFields> {
  const m = await sharp(path).metadata()
  return { ...EMPTY_PROBE, width: m.width ?? null, height: m.height ?? null }
}

interface TaskRow {
  path: string
  type: 'video' | 'photo'
  lrf_path: string | null
}

interface FullRow extends TaskRow {
  name: string
  dir_date: string
  size: number
  taken_at: number
  duration: number | null
  width: number | null
  height: number | null
  fps: number | null
  vcodec: string | null
  acodec: string | null
  bitrate: number | null
  probe_src: string | null
  meta_at: number
}

function saveMeta(path: string, f: ProbeFields, src: string): void {
  getDb()
    .prepare(
      `UPDATE files SET duration = ?, width = ?, height = ?, fps = ?, vcodec = ?,
       acodec = ?, bitrate = ?, probe_src = ?, meta_at = ? WHERE path = ?`
    )
    .run(f.duration, f.width, f.height, f.fps, f.vcodec, f.acodec, f.bitrate, src, Date.now(), path)
}

async function probeTask(row: TaskRow): Promise<void> {
  if (row.type === 'photo') {
    saveMeta(row.path, await probePhoto(row.path), 'sharp')
  } else {
    const { fields, src } = await probeVideo(row.path, row.lrf_path)
    saveMeta(row.path, fields, src)
  }
}

export async function generateAllMetadata(
  onProgress?: (p: MetaProgress) => void
): Promise<MetaResult> {
  const started = Date.now()
  const rows = getDb()
    .prepare('SELECT path, type, lrf_path FROM files WHERE meta_at = 0')
    .all() as TaskRow[]
  const queue = [...rows]
  const state: MetaProgress = { done: 0, total: rows.length, succeeded: 0, failed: 0 }

  const worker = async () => {
    while (queue.length > 0) {
      const row = queue.shift()
      if (!row) break
      try {
        await probeTask(row)
        state.succeeded++
      } catch {
        state.failed++
      }
      state.done++
      onProgress?.({ ...state })
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return { ...state, elapsedMs: Date.now() - started }
}

function fileSize(path: string | null): number | null {
  if (!path) return null
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

export async function readMeta(path: string): Promise<MediaMeta> {
  const db = getDb()
  let row = db.prepare('SELECT * FROM files WHERE path = ?').get(path) as FullRow | undefined
  if (!row) throw new Error('媒体不存在于索引中，请先重新扫描')

  if (row.meta_at === 0) {
    try {
      await probeTask({ path: row.path, type: row.type, lrf_path: row.lrf_path })
    } catch {
      // 探测失败仍返回基础信息，元数据字段留空
    }
    row = db.prepare('SELECT * FROM files WHERE path = ?').get(path) as FullRow
  }

  return {
    path: row.path,
    name: row.name,
    type: row.type,
    dir_date: row.dir_date,
    size: row.size,
    taken_at: row.taken_at,
    lrf_path: row.lrf_path,
    lrf_size: fileSize(row.lrf_path),
    duration: row.duration,
    width: row.width,
    height: row.height,
    fps: row.fps,
    vcodec: row.vcodec,
    acodec: row.acodec,
    bitrate: row.bitrate,
    probe_src: row.probe_src,
    exists: existsSync(row.path),
    probed_at: row.meta_at
  }
}
