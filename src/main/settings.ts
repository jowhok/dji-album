import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import type { NasSettings } from '../shared/types'

export type { NasSettings }

const DEFAULTS: NasSettings = {
  host: '192.168.5.32',
  share: 'DJI-47388491',
  username: 'DJI',
  rootDir: 'DJI Device/OsmoPocket4P-5747'
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): NasSettings {
  const f = settingsFile()
  if (!existsSync(f)) return { ...DEFAULTS }
  try {
    const s = { ...DEFAULTS, ...JSON.parse(readFileSync(f, 'utf-8')) }
    return s.configured ? s : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

export function isConfigured(): boolean {
  return getSettings().configured === true
}

export function getRootPath(s: NasSettings): string {
  return `\\\\${s.host}\\${s.share}\\${s.rootDir.replace(/\//g, '\\')}`
}

export function saveSettings(s: NasSettings, password?: string): { ok: boolean; error?: string } {
  const merged = { ...DEFAULTS, ...s }
  if (!merged.host || !merged.share || !merged.username) {
    return { ok: false, error: 'host / share / username 不能为空' }
  }
  writeFileSync(
    settingsFile(),
    JSON.stringify({ ...merged, configured: true }, null, 2),
    'utf-8'
  )
  if (password) {
    try {
      execFileSync('cmdkey', [
        `/add:${merged.host}`,
        `/user:${merged.username}`,
        `/pass:${password}`
      ], { windowsHide: true })
    } catch (e) {
      return { ok: false, error: `凭据写入失败: ${(e as Error).message}` }
    }
  }
  return { ok: true }
}

export async function testConnection(s: NasSettings): Promise<{ ok: boolean; error?: string }> {
  const root = getRootPath(s)
  try {
    const fs = await import('fs')
    const st = await fs.promises.stat(root)
    if (!st.isDirectory()) return { ok: false, error: `${root} 不是目录` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `无法访问 ${root}: ${(e as Error).message}` }
  }
}
