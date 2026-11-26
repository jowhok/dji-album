import { useEffect, useState } from 'react'
import type { NasSettings, ScanProgress } from '../../shared/types'
import Icon from './Icon'

export default function Onboarding({ onDone }: { onDone: (root: string) => void }) {
  const [form, setForm] = useState({
    host: '192.168.5.32',
    share: 'DJI-47388491',
    username: 'DJI',
    rootDir: 'DJI Device/OsmoPocket4P-5747'
  })
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value })

  useEffect(() => {
    return window.api.onScanProgress((p) => setProgress(p))
  }, [])

  async function handleSave() {
    setError('')
    setBusy(true)
    try {
      const r = await window.api.saveSettings(form as NasSettings, password || undefined)
      if (!r.ok) {
        setError(r.error ?? '连接失败')
        return
      }
      const s = await window.api.scan()
      if (!s.ok) {
        setError(`扫描失败: ${s.error}`)
        return
      }
      const { root } = await window.api.getSettings()
      onDone(root)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setup-wrap">
      <div className="setup-card">
        <h2>连接 NAS</h2>
        <div className="desc">
          首次使用请填写 NAS 的 SMB 信息，密码将保存到 Windows 凭据管理器（软件内不存储）。
        </div>
        <label>
          主机地址
          <input value={form.host} onChange={set('host')} placeholder="192.168.5.32" />
        </label>
        <label>
          共享名称
          <input value={form.share} onChange={set('share')} placeholder="DJI-47388491" />
        </label>
        <label>
          照片根目录（相对共享）
          <input value={form.rootDir} onChange={set('rootDir')} />
        </label>
        <label>
          用户名
          <input value={form.username} onChange={set('username')} />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="留空则沿用已保存凭据"
          />
        </label>
        {error && <div className="error-text">{error}</div>}
        {busy && progress && (
          <div className="progress-wrap">
            正在扫描 {progress.current}（{progress.done}/{progress.total}）
            <div className="progress-bar">
              <div
                className="fill"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
        <button className="btn primary" disabled={busy} onClick={() => void handleSave()}>
          <Icon name="server" size={16} />
          {busy ? '连接并扫描中…' : '保存并测试连接'}
        </button>
      </div>
    </div>
  )
}
