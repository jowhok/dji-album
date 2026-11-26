export interface NasSettings {
  host: string
  share: string
  username: string
  rootDir: string
  configured?: boolean
}

export type MediaType = 'video' | 'photo'

export interface MediaRow {
  path: string
  name: string
  type: MediaType
  dir_date: string
  size: number
  taken_at: number
  thumb: string | null
  lrf_path: string | null
  fav: number
  duration: number | null
  meta_at: number
}

export interface ProbeFields {
  duration: number | null
  width: number | null
  height: number | null
  fps: number | null
  vcodec: string | null
  acodec: string | null
  bitrate: number | null
}

export interface MediaMeta extends ProbeFields {
  path: string
  name: string
  type: MediaType
  dir_date: string
  size: number
  taken_at: number
  lrf_path: string | null
  lrf_size: number | null
  probe_src: string | null
  exists: boolean
  probed_at: number
}

export interface TrashRow {
  path: string
  name: string
  type: MediaType
  dir_date: string
  size: number
  thumb: string | null
  deleted_at: number
}

/** 彻底删除：单个待删的 NAS 物理文件 */
export interface PurgeFile {
  path: string
  size: number
  exists: boolean
}

export interface PurgePlanItem {
  path: string
  name: string
  type: MediaType
  size: number
  thumb: string | null
  files: PurgeFile[]
}

/** 确认弹窗用的预览（只读，不删任何文件） */
export interface PurgePreview {
  items: PurgePlanItem[]
  totalFiles: number
  totalBytes: number
  rejected: string[]
}

export interface PurgeItemResult {
  path: string
  ok: boolean
  deleted: string[]
  failed: Array<{ path: string; error: string }>
}

export interface PurgeResult {
  total: number
  succeeded: number
  failed: number
  bytes: number
  items: PurgeItemResult[]
}

export interface ScanProgress {
  done: number
  total: number
  current: string
}

export interface ScanResult {
  videos: number
  photos: number
  dirs: number
}

export interface ThumbProgress {
  done: number
  total: number
  succeeded: number
  failed: number
}

export interface ThumbResult extends ThumbProgress {
  elapsedMs: number
}

export interface MetaProgress {
  done: number
  total: number
  succeeded: number
  failed: number
}

export interface MetaResult extends MetaProgress {
  elapsedMs: number
}

export interface SaveProgress {
  done: number
  total: number
  path: string
}

export interface SaveResult {
  ok: boolean
  canceled?: boolean
  path?: string
  bytes?: number
  error?: string
}

/** 主进程登记后返回的相对 URL（渲染层拼 http://127.0.0.1:<port>） */
export interface MediaUrls {
  mp4: string
  lrf: string | null
}

export interface Result<T = undefined> {
  ok: boolean
  error?: string
  data?: T
}

/** 设置页：应用信息与运行统计（只读） */
export interface AppInfo {
  version: string
  electron: string
  node: string
  userData: string
  dbPath: string
  thumbsDir: string
  root: string
  mediaPort: number
  cacheFiles: number
  cacheBytes: number
  cacheLimitBytes: number
  files: number
  videos: number
  photos: number
  favorites: number
  trash: number
  thumbMissing: number
  totalBytes: number
}

export interface CacheClearResult {
  ok: boolean
  deleted?: number
  bytes?: number
  error?: string
}

export interface CacheTrimResult {
  ok: boolean
  deleted: number
  bytes: number
  limitBytes: number
  totalBytes: number
}
