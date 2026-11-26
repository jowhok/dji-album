export function fmtDate(dirDate: string): string {
  if (!/^\d{8}$/.test(dirDate)) return dirDate
  return `${dirDate.slice(0, 4)}-${dirDate.slice(4, 6)}-${dirDate.slice(6, 8)}`
}

export function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec < 0) return '--:--'
  const s = Math.floor(sec)
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

export function fmtDateTime(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}
