import type {
  NasSettings, MediaRow, MediaMeta, MediaUrls, TrashRow, ScanProgress,
  ThumbProgress, ThumbResult, MetaProgress, MetaResult,
  SaveProgress, SaveResult, PurgePreview, PurgeResult, Result,
  AppInfo, CacheClearResult, CacheTrimResult
} from '../../shared/types'

interface ScanResponse {
  ok: boolean
  error?: string
  videos?: number
  photos?: number
  dirs?: number
}

declare global {
  interface Window {
    api: {
      getSettings(): Promise<{ settings: NasSettings; root: string }>
      saveSettings(s: NasSettings, password?: string): Promise<Result>
      testSettings(s: NasSettings): Promise<Result>
      getAppInfo(): Promise<AppInfo>
      clearCache(): Promise<CacheClearResult>
      nasStatus(): Promise<Result>
      trimCache(): Promise<CacheTrimResult>
      scan(): Promise<ScanResponse>
      listFiles(
        type: 'all' | 'video' | 'photo',
        sort: 'time' | 'size',
        scope?: 'all' | 'favorites'
      ): Promise<MediaRow[]>
      getMediaPort(): Promise<number>
      generateThumbs(): Promise<{ ok: boolean; error?: string } & Partial<ThumbResult>>
      generateMetadata(): Promise<{ ok: boolean; error?: string } & Partial<MetaResult>>
      getMeta(path: string): Promise<Result<MediaMeta>>
      getMediaUrls(path: string, lrfPath: string | null): Promise<Result<MediaUrls>>
      toggleFav(path: string): Promise<Result<boolean>>
      saveAs(path: string): Promise<SaveResult>
      moveToTrash(paths: string[]): Promise<Result>
      listTrash(): Promise<TrashRow[]>
      restore(paths: string[]): Promise<Result>
      purgePreview(paths: string[]): Promise<Result<PurgePreview>>
      purge(paths: string[]): Promise<Result<PurgeResult>>
      setTheme(mode: 'light' | 'dark' | 'system', resolved: 'light' | 'dark'): Promise<'light' | 'dark'>
      isFullscreen(): Promise<boolean>
      toggleFullscreen(): Promise<boolean>
      onFullscreenChange(cb: (full: boolean) => void): () => void
      onScanProgress(cb: (p: ScanProgress) => void): () => void
      onThumbProgress(cb: (p: ThumbProgress) => void): () => void
      onMetaProgress(cb: (p: MetaProgress) => void): () => void
      onSaveProgress(cb: (p: SaveProgress) => void): () => void
    }
  }
}

export {}
