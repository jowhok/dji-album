import { ipcMain, dialog, BrowserWindow, nativeTheme, app } from 'electron'
import { createReadStream, createWriteStream, existsSync, statSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getSettings, saveSettings, testConnection, getRootPath } from './settings'
import { scanRoot } from './scanner'
import { getDb } from './db'
import { generateAllThumbs, getThumbsDir } from './thumbnails'
import { generateAllMetadata, readMeta } from './metadata'
import { getMediaPort, registerMediaFile } from './media-server'
import { buildPurgePlan, executePurge } from './purge'
import { trimCache, CACHE_LIMIT_BYTES } from './cache'
import type {
  MediaRow, MediaMeta, MediaUrls, NasSettings, TrashRow,
  PurgePreview, PurgeResult, Result, AppInfo, CacheClearResult, CacheTrimResult
} from '../shared/types'

export type { MediaRow }

type Scope = 'all' | 'favorites'

// 只统计/删除应用自身缩略图缓存目录下的 .jpg 普通文件，不递归、不碰 NAS
function cacheStats(): { files: number; bytes: number } {
  const dir = getThumbsDir()
  let files = 0
  let bytes = 0
  try {
    for (const name of readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.jpg')) continue
      try {
        const st = statSync(join(dir, name))
        if (st.isFile()) { files += 1; bytes += st.size }
      } catch { /* 单个文件失效，跳过 */ }
    }
  } catch { /* 目录尚未创建 */ }
  return { files, bytes }
}

export function registerIpc(win: BrowserWindow): void {
  // ---- 外观 / 全屏（M6）----
  ipcMain.handle(
    'app:setTheme',
    (_e, mode: 'light' | 'dark' | 'system', resolved: 'light' | 'dark'): 'light' | 'dark' => {
      nativeTheme.themeSource = mode
      win.setBackgroundColor(resolved === 'light' ? '#f6f5f2' : '#1b1b19')
      return resolved
    }
  )

  let lastFsToggle = 0
  const toggleFullscreen = (): boolean => {
    const now = Date.now()
    // 防抖：Chromium 内建 F11 与自定义处理可能同时到达，避免互相抵消
    if (now - lastFsToggle < 220) return win.isFullScreen()
    lastFsToggle = now
    const next = !win.isFullScreen()
    win.setFullScreen(next)
    return next
  }

  ipcMain.handle('app:isFullscreen', (): boolean => win.isFullScreen())
  ipcMain.handle('app:toggleFullscreen', (): boolean => toggleFullscreen())
  win.on('enter-full-screen', () => win.webContents.send('app:fullscreenChanged', true))
  win.on('leave-full-screen', () => win.webContents.send('app:fullscreenChanged', false))
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault()
      toggleFullscreen()
    }
  })

  ipcMain.handle('settings:get', () => {
    const s = getSettings()
    return { settings: s, root: getRootPath(s) }
  })

  ipcMain.handle('settings:save', (_e, s: NasSettings, password?: string) => {
    const r = saveSettings(s, password)
    if (!r.ok) return r
    return testConnection(s)
  })

  // 只测连接，不写 settings.json / 不动 Windows 凭据
  ipcMain.handle('settings:test', async (_e, s: NasSettings): Promise<Result> => {
    return await testConnection(s)
  })

  // ---- 设置页：运行信息与缓存维护 ----
  ipcMain.handle('app:info', (): AppInfo => {
    const db = getDb()
    const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
    const s = getSettings()
    const cache = cacheStats()
    return {
      version: app.getVersion(),
      electron: process.versions.electron ?? '-',
      node: process.versions.node,
      userData: app.getPath('userData'),
      dbPath: join(app.getPath('userData'), 'album.db'),
      thumbsDir: getThumbsDir(),
      root: getRootPath(s),
      mediaPort: getMediaPort(),
      cacheFiles: cache.files,
      cacheBytes: cache.bytes,
      cacheLimitBytes: CACHE_LIMIT_BYTES,
      files: count('SELECT COUNT(*) AS n FROM files'),
      videos: count("SELECT COUNT(*) AS n FROM files WHERE type = 'video'"),
      photos: count("SELECT COUNT(*) AS n FROM files WHERE type = 'photo'"),
      favorites: count('SELECT COUNT(*) AS n FROM favorites'),
      trash: count('SELECT COUNT(*) AS n FROM trash'),
      thumbMissing: count('SELECT COUNT(*) AS n FROM files WHERE thumb IS NULL'),
      totalBytes: count('SELECT COALESCE(SUM(size), 0) AS n FROM files')
    }
  })

  ipcMain.handle('cache:clear', (): CacheClearResult => {
    const dir = getThumbsDir()
    let deleted = 0
    let bytes = 0
    try {
      for (const name of readdirSync(dir)) {
        if (!name.toLowerCase().endsWith('.jpg')) continue
        const f = join(dir, name)
        try {
          const st = statSync(f)
          if (!st.isFile()) continue
          unlinkSync(f)
          deleted += 1
          bytes += st.size
        } catch { /* 单个文件删不掉就跳过，不影响其余 */ }
      }
      // 缓存文件已删，清掉索引里的引用，避免卡片指向不存在的文件
      getDb().prepare('UPDATE files SET thumb = NULL').run()
      return { ok: true, deleted, bytes }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // NAS 连通性探测：侧栏状态与错误提示用，只读、不改设置
  ipcMain.handle('nas:status', async (): Promise<Result> => await testConnection(getSettings()))

  // 缓存 LRU：生成缩略图后自动触发，也可在设置页手动清理超额部分
  ipcMain.handle('cache:trim', (): CacheTrimResult => trimCache())

  ipcMain.handle('scan:run', async () => {
    const s = getSettings()
    const root = getRootPath(s)
    try {
      const result = await scanRoot(root, (p) => win.webContents.send('scan:progress', p))
      return { ok: true, ...result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('server:port', () => getMediaPort())

  ipcMain.handle('thumbs:generate', async () => {
    try {
      const result = await generateAllThumbs((p) => win.webContents.send('thumbs:progress', p))
      trimCache()
      return { ok: true, ...result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('meta:generate', async () => {
    try {
      const result = await generateAllMetadata((p) => win.webContents.send('meta:progress', p))
      return { ok: true, ...result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('files:list', (_e, type: 'all' | 'video' | 'photo', sort: 'time' | 'size', scope: Scope = 'all') => {
    const db = getDb()
    const orderBy =
      sort === 'size'
        ? 'f.dir_date DESC, f.size DESC'
        : 'f.dir_date DESC, f.taken_at DESC'
    const sql = `
      SELECT f.path, f.name, f.type, f.dir_date, f.size, f.taken_at, f.thumb, f.lrf_path,
             f.duration, f.meta_at,
             CASE WHEN fav.path IS NOT NULL THEN 1 ELSE 0 END AS fav
      FROM files f
      LEFT JOIN favorites fav ON fav.path = f.path
      LEFT JOIN trash tr ON tr.path = f.path
      WHERE tr.path IS NULL
        AND (? = 'all' OR f.type = ?)
        AND (? = 'all' OR fav.path IS NOT NULL)
      ORDER BY ${orderBy}
    `
    return db.prepare(sql).all(type, type, scope) as MediaRow[]
  })

  ipcMain.handle('fav:toggle', (_e, path: string): Result<boolean> => {
    try {
      const db = getDb()
      const exists = db.prepare('SELECT 1 FROM favorites WHERE path = ?').get(path)
      if (exists) {
        db.prepare('DELETE FROM favorites WHERE path = ?').run(path)
        return { ok: true, data: false }
      }
      db.prepare('INSERT OR IGNORE INTO favorites(path, created_at) VALUES (?, ?)').run(path, Date.now())
      return { ok: true, data: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('file:metadata', async (_e, path: string): Promise<Result<MediaMeta>> => {
    try {
      return { ok: true, data: await readMeta(path) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // 只登记 DB 白名单内的路径，避免渲染层借 token 读取任意本地文件
  ipcMain.handle('file:mediaUrls', (_e, path: string, lrfPath: string | null): Result<MediaUrls> => {
    try {
      const row = getDb()
        .prepare('SELECT path, lrf_path FROM files WHERE path = ?')
        .get(path) as { path: string; lrf_path: string | null } | undefined
      if (!row) return { ok: false, error: '文件不在索引中，请先重新扫描' }
      const mp4 = registerMediaFile(row.path)
      const lrf = row.lrf_path && row.lrf_path === lrfPath ? registerMediaFile(row.lrf_path) : null
      return { ok: true, data: { mp4, lrf } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('file:trash', (_e, paths: string[]): Result => {
    try {
      const db = getDb()
      const known = db.prepare('SELECT 1 FROM files WHERE path = ?')
      const ins = db.prepare('INSERT OR IGNORE INTO trash(path, deleted_at) VALUES (?, ?)')
      db.transaction(() => {
        for (const p of paths) if (known.get(p)) ins.run(p, Date.now())
      })()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('trash:list', (): TrashRow[] => {
    return getDb()
      .prepare(
        `SELECT f.path, f.name, f.type, f.dir_date, f.size, f.thumb, t.deleted_at
         FROM trash t JOIN files f ON f.path = t.path
         ORDER BY t.deleted_at DESC`
      )
      .all() as TrashRow[]
  })

  ipcMain.handle('trash:restore', (_e, paths: string[]): Result => {
    try {
      const del = getDb().prepare('DELETE FROM trash WHERE path = ?')
      getDb().transaction(() => paths.forEach((p) => del.run(p)))()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // 只读预览：列出将被真实删除的每个 NAS 文件，供二次确认弹窗展示
  ipcMain.handle('trash:purgePreview', (_e, paths: string[]): Result<PurgePreview> => {
    try {
      const items = buildPurgePlan(paths, getRootPath(getSettings()))
      const known = new Set(items.map((i) => i.path))
      return {
        ok: true,
        data: {
          items,
          totalFiles: items.reduce((n, i) => n + i.files.length, 0),
          totalBytes: items.reduce(
            (n, i) => n + i.files.reduce((m, f) => m + (f.exists ? f.size : 0), 0),
            0
          ),
          rejected: [...new Set(paths)].filter((p) => !known.has(p))
        }
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('trash:purge', (_e, paths: string[]): Result<PurgeResult> => {
    try {
      return { ok: true, data: executePurge(paths, getRootPath(getSettings())) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('file:saveAs', async (_e, path: string) => {
    const row = getDb()
      .prepare('SELECT name FROM files WHERE path = ?')
      .get(path) as { name: string } | undefined
    if (!row) return { ok: false, error: '文件不在索引中，请先重新扫描' }
    if (!existsSync(path)) return { ok: false, error: 'NAS 上找不到该文件' }

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '下载原片',
      defaultPath: row.name,
      filters: [
        { name: '视频文件', extensions: ['mp4'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (canceled || !filePath) return { ok: false, canceled: true }

    try {
      const total = statSync(path).size
      let done = 0
      await new Promise<void>((resolve, reject) => {
        const rs = createReadStream(path)
        const ws = createWriteStream(filePath)
        rs.on('data', (chunk: Buffer) => {
          done += chunk.length
          win.webContents.send('save:progress', { done, total, path: filePath })
        })
        rs.on('error', reject)
        ws.on('error', reject)
        ws.on('finish', resolve)
        rs.pipe(ws)
      })
      win.webContents.send('save:progress', { done: total, total, path: filePath })
      return { ok: true, path: filePath, bytes: total }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}
