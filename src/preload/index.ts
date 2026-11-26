import { contextBridge, ipcRenderer } from 'electron'
import type {
  NasSettings, MediaRow, MediaMeta, MediaUrls, TrashRow, ScanProgress,
  ThumbProgress, ThumbResult, MetaProgress, MetaResult,
  SaveProgress, SaveResult, PurgePreview, PurgeResult, Result,
  AppInfo, CacheClearResult, CacheTrimResult
} from '../shared/types'

export type {
  NasSettings, MediaRow, MediaMeta, MediaUrls, TrashRow, ScanProgress,
  ThumbProgress, ThumbResult, MetaProgress, MetaResult, SaveProgress, SaveResult,
  PurgePreview, PurgeResult, Result, AppInfo, CacheClearResult, CacheTrimResult
}

const api = {
  getSettings: (): Promise<{ settings: NasSettings; root: string }> =>
    ipcRenderer.invoke('settings:get'),
  saveSettings: (s: NasSettings, password?: string): Promise<Result> =>
    ipcRenderer.invoke('settings:save', s, password),
  testSettings: (s: NasSettings): Promise<Result> => ipcRenderer.invoke('settings:test', s),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  clearCache: (): Promise<CacheClearResult> => ipcRenderer.invoke('cache:clear'),
  nasStatus: (): Promise<Result> => ipcRenderer.invoke('nas:status'),
  trimCache: (): Promise<CacheTrimResult> => ipcRenderer.invoke('cache:trim'),
  scan: (): Promise<{ ok: boolean; error?: string; videos?: number; photos?: number; dirs?: number }> =>
    ipcRenderer.invoke('scan:run'),
  listFiles: (
    type: 'all' | 'video' | 'photo',
    sort: 'time' | 'size',
    scope?: 'all' | 'favorites'
  ): Promise<MediaRow[]> => ipcRenderer.invoke('files:list', type, sort, scope ?? 'all'),
  getMediaPort: (): Promise<number> => ipcRenderer.invoke('server:port'),
  generateThumbs: (): Promise<{ ok: boolean; error?: string } & Partial<ThumbResult>> =>
    ipcRenderer.invoke('thumbs:generate'),
  generateMetadata: (): Promise<{ ok: boolean; error?: string } & Partial<MetaResult>> =>
    ipcRenderer.invoke('meta:generate'),
  getMeta: (path: string): Promise<Result<MediaMeta>> => ipcRenderer.invoke('file:metadata', path),
  getMediaUrls: (path: string, lrfPath: string | null): Promise<Result<MediaUrls>> =>
    ipcRenderer.invoke('file:mediaUrls', path, lrfPath),
  toggleFav: (path: string): Promise<Result<boolean>> => ipcRenderer.invoke('fav:toggle', path),
  saveAs: (path: string): Promise<SaveResult> => ipcRenderer.invoke('file:saveAs', path),
  moveToTrash: (paths: string[]): Promise<Result> => ipcRenderer.invoke('file:trash', paths),
  listTrash: (): Promise<TrashRow[]> => ipcRenderer.invoke('trash:list'),
  restore: (paths: string[]): Promise<Result> => ipcRenderer.invoke('trash:restore', paths),
  purgePreview: (paths: string[]): Promise<Result<PurgePreview>> =>
    ipcRenderer.invoke('trash:purgePreview', paths),
  purge: (paths: string[]): Promise<Result<PurgeResult>> =>
    ipcRenderer.invoke('trash:purge', paths),
  setTheme: (mode: 'light' | 'dark' | 'system', resolved: 'light' | 'dark'): Promise<'light' | 'dark'> =>
    ipcRenderer.invoke('app:setTheme', mode, resolved),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('app:isFullscreen'),
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('app:toggleFullscreen'),
  onFullscreenChange: (cb: (full: boolean) => void): (() => void) => {
    const listener = (_e: unknown, v: boolean) => cb(v)
    ipcRenderer.on('app:fullscreenChanged', listener)
    return () => ipcRenderer.removeListener('app:fullscreenChanged', listener)
  },
  onScanProgress: (cb: (p: ScanProgress) => void): (() => void) => {
    const listener = (_e: unknown, v: ScanProgress) => cb(v)
    ipcRenderer.on('scan:progress', listener)
    return () => ipcRenderer.removeListener('scan:progress', listener)
  },
  onThumbProgress: (cb: (p: ThumbProgress) => void): (() => void) => {
    const listener = (_e: unknown, v: ThumbProgress) => cb(v)
    ipcRenderer.on('thumbs:progress', listener)
    return () => ipcRenderer.removeListener('thumbs:progress', listener)
  },
  onMetaProgress: (cb: (p: MetaProgress) => void): (() => void) => {
    const listener = (_e: unknown, v: MetaProgress) => cb(v)
    ipcRenderer.on('meta:progress', listener)
    return () => ipcRenderer.removeListener('meta:progress', listener)
  },
  onSaveProgress: (cb: (p: SaveProgress) => void): (() => void) => {
    const listener = (_e: unknown, v: SaveProgress) => cb(v)
    ipcRenderer.on('save:progress', listener)
    return () => ipcRenderer.removeListener('save:progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
