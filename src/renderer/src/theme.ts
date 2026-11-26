export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'dji-album-theme'

export function getThemeMode(): ThemeMode {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark'
}

export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(KEY, mode)
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme
}

/** 系统偏好变化时回调（仅在 system 模式下有意义，但监听本身无害） */
export function onSystemThemeChange(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
