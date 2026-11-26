import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { getDb } from './db'
import type { ScanProgress, ScanResult } from '../shared/types'

export type { ScanProgress, ScanResult }

const PHOTO_EXT = new Set(['.jpg', '.jpeg'])

interface FileInfo {
  full: string
  size: number
  mtime: number
}

export async function scanRoot(
  root: string,
  onProgress?: (p: ScanProgress) => void
): Promise<ScanResult> {
  const db = getDb()
  const entries = await readdir(root, { withFileTypes: true })
  const dateDirs = entries
    .filter((e) => e.isDirectory() && /^\d{8}$/.test(e.name))
    .map((e) => e.name)

  const seen = new Set<string>()
  let videos = 0
  let photos = 0

  const upsert = db.prepare(`
    INSERT INTO files (path, name, type, dir_date, size, taken_at, lrf_path, indexed_at)
    VALUES (@path, @name, @type, @dir_date, @size, @taken_at, @lrf_path, @indexed_at)
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name, type = excluded.type, dir_date = excluded.dir_date,
      size = excluded.size, taken_at = excluded.taken_at, lrf_path = excluded.lrf_path,
      indexed_at = excluded.indexed_at
  `)

  for (let i = 0; i < dateDirs.length; i++) {
    const d = dateDirs[i]
    const dir = join(root, d)
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }

    const mp4s = new Map<string, FileInfo>()
    const lrfs = new Map<string, FileInfo>()

    for (const f of names) {
      const dot = f.lastIndexOf('.')
      if (dot < 0) continue
      const ext = f.slice(dot).toLowerCase()
      const full = join(dir, f)
      let st
      try {
        st = await stat(full)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      const info: FileInfo = { full, size: st.size, mtime: Math.round(st.mtimeMs) }
      const base = f.slice(0, dot)

      if (ext === '.mp4') {
        mp4s.set(base, info)
      } else if (ext === '.lrf') {
        lrfs.set(base, info)
      } else if (PHOTO_EXT.has(ext)) {
        upsert.run({
          path: full, name: f, type: 'photo', dir_date: d,
          size: info.size, taken_at: info.mtime, lrf_path: null, indexed_at: Date.now()
        })
        seen.add(full)
        photos++
      }
    }

    const bases = new Set([...mp4s.keys(), ...lrfs.keys()])
    for (const base of bases) {
      const mp4 = mp4s.get(base)
      const lrf = lrfs.get(base)
      const primary = mp4 ?? lrf
      if (!primary) continue
      const name = base + (mp4 ? '.mp4' : '.lrf')
      upsert.run({
        path: primary.full, name, type: 'video', dir_date: d,
        size: primary.size, taken_at: primary.mtime,
        lrf_path: lrf ? lrf.full : null, indexed_at: Date.now()
      })
      seen.add(primary.full)
      videos++
    }

    onProgress?.({ done: i + 1, total: dateDirs.length, current: d })
  }

  const stale = (db.prepare('SELECT path FROM files').all() as { path: string }[])
    .filter((r) => !seen.has(r.path))
  if (stale.length > 0) {
    const del = db.prepare('DELETE FROM files WHERE path = ?')
    db.transaction(() => stale.forEach((r) => del.run(r.path)))()
  }

  return { videos, photos, dirs: dateDirs.length }
}
