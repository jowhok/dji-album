import { existsSync, statSync, unlinkSync } from 'fs'
import { win32 } from 'path'
import { getDb } from './db'
import { getThumbsDir } from './thumbnails'
import { unregisterMediaFile } from './media-server'
import type { PurgePlanItem, PurgeFile, PurgeItemResult, PurgeResult } from '../shared/types'

const ALLOWED_EXT = new Set(['.mp4', '.lrf', '.jpg', '.jpeg'])

interface PlanRow {
  path: string
  name: string
  type: 'video' | 'photo'
  size: number
  lrf_path: string | null
  thumb: string | null
}

/** 只接受位于 NAS 根目录内、扩展名在白名单内的物理文件。resolve 会展开 ..，可挡目录穿越。 */
function safeFile(file: string, root: string): boolean {
  if (!ALLOWED_EXT.has(win32.extname(file).toLowerCase())) return false
  const r = win32.resolve(root)
  const f = win32.resolve(file)
  return f.toLowerCase().startsWith(r.toLowerCase() + '\\')
}

/**
 * 构建彻底删除计划：只处理「在索引中 + 在回收站内」的媒体。
 * 渲染层传来的 paths 不可信，执行时会重新构建一次。
 */
export function buildPurgePlan(paths: string[], root: string): PurgePlanItem[] {
  const stmt = getDb().prepare(`
    SELECT f.path, f.name, f.type, f.size, f.lrf_path, f.thumb
    FROM files f JOIN trash t ON t.path = f.path
    WHERE f.path = ?
  `)
  const items: PurgePlanItem[] = []
  for (const p of new Set(paths)) {
    const row = stmt.get(p) as PlanRow | undefined
    if (!row) continue
    if (!safeFile(row.path, root)) continue

    // 孤儿 LRF 的 path 与 lrf_path 可能相同，去重避免重复 unlink
    const candidates = new Set([row.path, ...(row.lrf_path ? [row.lrf_path] : [])])
    const files: PurgeFile[] = []
    for (const c of candidates) {
      if (!safeFile(c, root)) continue
      let size = 0
      let exists = false
      try {
        const st = statSync(c)
        if (st.isFile()) {
          size = st.size
          exists = true
        }
      } catch {
        // 文件已不存在：列进清单但执行时跳过（幂等）
      }
      files.push({ path: c, size, exists })
    }
    if (files.length === 0) continue
    items.push({
      path: row.path,
      name: row.name,
      type: row.type,
      size: row.size,
      thumb: row.thumb,
      files
    })
  }
  return items
}

/** 执行彻底删除：逐文件 unlink（不递归、不通配），该媒体所有文件都成功才清库与缓存。 */
export function executePurge(paths: string[], root: string): PurgeResult {
  const plan = buildPurgePlan(paths, root)
  const db = getDb()
  const delFile = db.prepare('DELETE FROM files WHERE path = ?')
  const delFav = db.prepare('DELETE FROM favorites WHERE path = ?')
  const delTrash = db.prepare('DELETE FROM trash WHERE path = ?')
  const items: PurgeItemResult[] = []
  let succeeded = 0
  let failed = 0
  let bytes = 0

  for (const item of plan) {
    const deleted: string[] = []
    const errors: Array<{ path: string; error: string }> = []
    for (const f of item.files) {
      if (!existsSync(f.path)) continue // 幂等：之前已删成功但库未清理，可安全重试
      try {
        unlinkSync(f.path)
        deleted.push(f.path)
        bytes += f.size
        unregisterMediaFile(f.path)
      } catch (e) {
        errors.push({ path: f.path, error: (e as Error).message })
      }
    }

    const ok = errors.length === 0
    if (ok) {
      db.transaction(() => {
        delFile.run(item.path)
        delFav.run(item.path)
        delTrash.run(item.path)
      })()
      if (item.thumb) {
        try {
          unlinkSync(win32.join(getThumbsDir(), item.thumb))
        } catch {
          // 缓存已不存在或删不掉都不影响主流程
        }
      }
      succeeded++
    } else {
      failed++
    }
    items.push({ path: item.path, ok, deleted, failed: errors })
  }

  return { total: plan.length, succeeded, failed, bytes, items }
}
