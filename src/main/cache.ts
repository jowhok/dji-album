import { readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getDb } from './db'
import { getThumbsDir } from './thumbnails'
import type { CacheTrimResult } from '../shared/types'

export const CACHE_LIMIT_BYTES = 512 * 1024 * 1024

/** 按 mtime 淘汰最旧的缩略图，直到总量低于上限。只碰应用自身缓存目录下的 .jpg。 */
export function trimCache(limitBytes = CACHE_LIMIT_BYTES): CacheTrimResult {
  const dir = getThumbsDir()
  const files: Array<{ name: string; size: number; mtime: number }> = []
  let total = 0
  try {
    for (const name of readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.jpg')) continue
      try {
        const st = statSync(join(dir, name))
        if (st.isFile()) {
          files.push({ name, size: st.size, mtime: st.mtimeMs })
          total += st.size
        }
      } catch { /* 单个文件失效，跳过 */ }
    }
  } catch {
    return { ok: true, deleted: 0, bytes: 0, limitBytes, totalBytes: 0 }
  }

  files.sort((a, b) => a.mtime - b.mtime)
  const cleared: string[] = []
  let bytes = 0
  for (const f of files) {
    if (total - bytes <= limitBytes) break
    try {
      unlinkSync(join(dir, f.name))
      cleared.push(f.name)
      bytes += f.size
    } catch { /* 删不掉就跳过，不影响其余 */ }
  }

  // 缓存文件已删，清掉索引引用，避免卡片指向不存在的图
  if (cleared.length) {
    const db = getDb()
    const stmt = db.prepare('UPDATE files SET thumb = NULL WHERE thumb = ?')
    db.transaction(() => cleared.forEach((n) => stmt.run(n)))()
  }
  return { ok: true, deleted: cleared.length, bytes, limitBytes, totalBytes: total - bytes }
}
