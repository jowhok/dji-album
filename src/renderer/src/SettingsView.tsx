import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import type {
  AppInfo, NasSettings, ScanProgress, ThumbProgress, MetaProgress
} from '../../shared/types'
import Icon from './Icon'
import { fmtSize } from './format'
import type { ThemeMode } from './theme'

interface Props {
  themeMode: ThemeMode
  onThemeChange: (m: ThemeMode) => void
  onRootChange: (root: string) => void
}

interface FormState {
  host: string
  share: string
  username: string
  rootDir: string
}

interface ProgressState {
  label: string
  done: number
  total: number
  current?: string
}

interface Msg {
  kind: 'ok' | 'err' | 'info'
  text: string
}

const EMPTY_FORM: FormState = { host: '', share: '', username: '', rootDir: '' }

const THEMES: Array<{ id: ThemeMode; label: string }> = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'system', label: '系统' }
]

const SHORTCUTS: Array<[string, string]> = [
  ['空格', '播放 / 暂停'],
  ['← / →', '快退 / 快进 5 秒'],
  ['↑ / ↓', '上一个 / 下一个'],
  ['F', '切换流畅 LRF / 高清 MP4'],
  ['+ / -', '放大 / 还原播放窗口'],
  ['Esc', '关闭菜单、弹窗或播放器'],
  ['F11', '全屏 / 退出全屏'],
  ['鼠标右键', '更多操作（元数据 / 收藏 / 下载 / 删除）']
]

export default function SettingsView({ themeMode, onThemeChange, onRootChange }: Props) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const load = useCallback(async () => {
    const i = await window.api.getAppInfo()
    setInfo(i)
    const { settings } = await window.api.getSettings()
    setForm({
      host: settings.host,
      share: settings.share,
      username: settings.username,
      rootDir: settings.rootDir
    })
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const offs = [
      window.api.onScanProgress((p: ScanProgress) =>
        setProgress({ label: '扫描 NAS', done: p.done, total: p.total, current: p.current })
      ),
      window.api.onThumbProgress((p: ThumbProgress) =>
        setProgress({ label: '重建缩略图', done: p.done, total: p.total })
      ),
      window.api.onMetaProgress((p: MetaProgress) =>
        setProgress({ label: '提取元数据', done: p.done, total: p.total })
      )
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const set = (k: keyof FormState) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }))

  async function doTest() {
    setBusy('test')
    setTestResult(null)
    setMsg(null)
    try {
      const r = await window.api.testSettings(form as NasSettings)
      setTestResult(r.ok ? { ok: true } : { ok: false, error: r.error })
    } finally {
      setBusy(null)
    }
  }

  async function doSave() {
    setBusy('save')
    setMsg(null)
    try {
      const r = await window.api.saveSettings(form as NasSettings, password || undefined)
      if (!r.ok) {
        setMsg({ kind: 'err', text: `保存失败：${r.error ?? '连接失败'}` })
        return
      }
      const { root } = await window.api.getSettings()
      onRootChange(root)
      setPassword('')
      setMsg({ kind: 'ok', text: '连接成功，设置已保存。若改了路径或账号，建议点一次「重新扫描」。' })
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function doScan() {
    setBusy('scan')
    setProgress(null)
    setMsg(null)
    try {
      const r = await window.api.scan()
      setMsg(
        r.ok
          ? { kind: 'ok', text: `扫描完成：${r.videos ?? 0} 个视频 / ${r.photos ?? 0} 张照片 / ${r.dirs ?? 0} 个日期目录` }
          : { kind: 'err', text: `扫描失败：${r.error}` }
      )
      await load()
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function doThumbs() {
    setBusy('thumbs')
    setProgress(null)
    setMsg(null)
    try {
      const r = await window.api.generateThumbs()
      setMsg(
        r.ok
          ? { kind: 'ok', text: `缩略图完成 ${r.done ?? 0}/${r.total ?? 0}，失败 ${r.failed ?? 0}` }
          : { kind: 'err', text: `生成失败：${r.error}` }
      )
      await load()
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function doMeta() {
    setBusy('meta')
    setProgress(null)
    setMsg(null)
    try {
      const r = await window.api.generateMetadata()
      setMsg(
        r.ok
          ? { kind: 'ok', text: `元数据完成 ${r.done ?? 0}/${r.total ?? 0}，失败 ${r.failed ?? 0}` }
          : { kind: 'err', text: `读取失败：${r.error}` }
      )
      await load()
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function doClear() {
    setConfirmClear(false)
    setBusy('clear')
    setMsg(null)
    try {
      const r = await window.api.clearCache()
      if (!r.ok) {
        setMsg({ kind: 'err', text: `清理失败：${r.error ?? '未知错误'}` })
        return
      }
      setMsg({
        kind: 'ok',
        text: `已清理 ${r.deleted ?? 0} 个缓存文件，释放 ${fmtSize(r.bytes ?? 0)}。NAS 原片未受影响，回到时光轴会自动重新生成缩略图。`
      })
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function doTrim() {
    setBusy('trim')
    setMsg(null)
    try {
      const r = await window.api.trimCache()
      setMsg({
        kind: 'ok',
        text: r.deleted > 0
          ? `已淘汰 ${r.deleted} 个最旧缩略图，释放 ${fmtSize(r.bytes)}；当前 ${fmtSize(r.totalBytes)} / 上限 ${fmtSize(r.limitBytes)}`
          : `缓存未超限（${fmtSize(r.totalBytes)} / ${fmtSize(r.limitBytes)}），无需清理`
      })
      await load()
    } finally {
      setBusy(null)
    }
  }

  const stat = (label: string, value: string) => (
    <div className="settings-stat" key={label}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )

  return (
    <div className="content settings-view">
      <div className="settings-inner">
        <div className="settings-head">
          <div>
            <h2>设置</h2>
            <p>NAS 连接、缓存与索引、外观与快捷键</p>
          </div>
          <button className="btn" disabled={busy !== null} onClick={() => void load()}>
            <Icon name="refresh" size={16} />刷新
          </button>
        </div>

        {msg && <div className={`settings-msg ${msg.kind}`}>{msg.text}</div>}

        {/* ---- NAS 连接 ---- */}
        <section className="settings-card">
          <div className="settings-card-head">
            <Icon name="server" size={17} />
            <h3>NAS 连接</h3>
            <span className="settings-badge">SMB</span>
          </div>
          <div className="settings-root" title={info?.root ?? ''}>
            <span>当前照片根目录</span>
            <code>{info?.root ?? '读取中…'}</code>
          </div>
          <div className="settings-form">
            <label>主机地址<input value={form.host} onChange={set('host')} placeholder="192.168.5.32" /></label>
            <label>共享名称<input value={form.share} onChange={set('share')} placeholder="DJI-47388491" /></label>
            <label>用户名<input value={form.username} onChange={set('username')} placeholder="DJI" /></label>
            <label>照片根目录（相对共享）<input value={form.rootDir} onChange={set('rootDir')} /></label>
            <label className="settings-form-wide">
              密码（留空沿用已保存的 Windows 凭据）
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="不修改请留空" />
            </label>
          </div>
          <div className="settings-actions">
            <button className="btn" disabled={busy !== null} onClick={() => void doTest()}>
              <Icon name="check" size={16} />测试连接
            </button>
            <button className="btn primary" disabled={busy !== null} onClick={() => void doSave()}>
              <Icon name="server" size={16} />{busy === 'save' ? '保存中…' : '保存设置'}
            </button>
          </div>
          {testResult && (
            <div className={`settings-test ${testResult.ok ? 'ok' : 'err'}`}>
              <Icon name={testResult.ok ? 'check' : 'alert'} size={15} />
              {testResult.ok ? '连接正常，可以访问该目录' : testResult.error}
            </div>
          )}
          <p className="settings-note">密码只写入 Windows 凭据管理器，软件配置文件里不保存。</p>
        </section>

        {/* ---- 缓存与索引 ---- */}
        <section className="settings-card">
          <div className="settings-card-head">
            <Icon name="database" size={17} />
            <h3>缓存与索引</h3>
          </div>
          <div className="settings-stats">
            {stat('媒体总数', info ? String(info.files) : '—')}
            {stat('视频 / 照片', info ? `${info.videos} / ${info.photos}` : '—')}
            {stat('收藏 / 回收站', info ? `${info.favorites} / ${info.trash}` : '—')}
            {stat('NAS 索引大小', info ? fmtSize(info.totalBytes) : '—')}
            {stat('缩略图缓存', info ? `${info.cacheFiles} 个` : '—')}
            {stat('缓存占用', info ? fmtSize(info.cacheBytes) : '—')}
            {stat('缓存上限', info ? fmtSize(info.cacheLimitBytes) : '—')}
            {stat('待生成缩略图', info ? String(info.thumbMissing) : '—')}
            {stat('媒体服务端口', info ? String(info.mediaPort) : '—')}
          </div>
          {progress && (
            <div className="progress-wrap settings-progress">
              {progress.label} {progress.done}/{progress.total}
              {progress.current ? ` · ${progress.current}` : ''}
              <div className="progress-bar">
                <div className="fill" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
            </div>
          )}
          <div className="settings-actions">
            <button className="btn" disabled={busy !== null} onClick={() => void doScan()}>
              <Icon name="scan" size={16} />重新扫描
            </button>
            <button className="btn" disabled={busy !== null} onClick={() => void doThumbs()}>
              <Icon name="image" size={16} />重建缩略图
            </button>
            <button className="btn" disabled={busy !== null} onClick={() => void doMeta()}>
              <Icon name="info" size={16} />重新提取元数据
            </button>
            <button className="btn" disabled={busy !== null} onClick={() => void doTrim()}>
              <Icon name="hardDrive" size={16} />清理超额缓存
            </button>
            <button className="btn danger" disabled={busy !== null} onClick={() => setConfirmClear(true)}>
              <Icon name="trash" size={16} />清理缓存
            </button>
          </div>
          <p className="settings-note">缓存目录：{info?.thumbsDir ?? '—'}（只存缩略图，可随时重建）。生成缩略图后会自动按最旧优先淘汰超过 512 MB 的部分。</p>
        </section>

        {/* ---- 外观 ---- */}
        <section className="settings-card">
          <div className="settings-card-head">
            <Icon name="sun" size={17} />
            <h3>外观</h3>
          </div>
          <div className="settings-row">
            <div>
              <strong>主题</strong>
              <span>侧边栏也有同样的控件，两处保持同步</span>
            </div>
            <div className="seg settings-theme" role="group" aria-label="主题">
              {THEMES.map((t) => (
                <span
                  key={t.id}
                  className={themeMode === t.id ? 'active' : ''}
                  onClick={() => onThemeChange(t.id)}
                  aria-pressed={themeMode === t.id}
                >
                  <Icon name={t.id === 'light' ? 'sun' : t.id === 'dark' ? 'moon' : 'monitor'} size={14} />
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ---- 快捷键 ---- */}
        <section className="settings-card">
          <div className="settings-card-head">
            <Icon name="film" size={17} />
            <h3>快捷键</h3>
          </div>
          <div className="settings-keys">
            {SHORTCUTS.map(([key, desc]) => (
              <div className="settings-key-row" key={key}>
                <kbd>{key}</kbd><span>{desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ---- 关于 ---- */}
        <section className="settings-card">
          <div className="settings-card-head">
            <Icon name="hardDrive" size={17} />
            <h3>关于</h3>
          </div>
          <div className="settings-kv">
            <span>应用版本</span><code>{info?.version ?? '—'}</code>
            <span>Electron / Node</span><code>{info ? `${info.electron} / ${info.node}` : '—'}</code>
            <span>数据目录</span><code>{info?.userData ?? '—'}</code>
            <span>数据库</span><code>{info?.dbPath ?? '—'}</code>
            <span>缩略图缓存</span><code>{info?.thumbsDir ?? '—'}</code>
          </div>
        </section>
      </div>

      {confirmClear && (
        <div className="confirm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmClear(false) }}>
          <div className="confirm-card" role="dialog" aria-label="清理缩略图缓存">
            <div className="confirm-head">
              <Icon name="alert" size={18} />
              <h3>清理缩略图缓存</h3>
            </div>
            <div className="confirm-body">
              <p className="confirm-warn">将删除应用缓存目录下的 {info?.cacheFiles ?? 0} 个缩略图文件（约 {fmtSize(info?.cacheBytes ?? 0)}），清理后需要重新生成。</p>
              <p>路径：<code>{info?.thumbsDir ?? '—'}</code></p>
              <p>仅删除该目录下的 .jpg 缓存；<strong>NAS 上的原片、数据库记录、收藏与回收站都不会被删除</strong>。回到时光轴时会自动重建缩略图。</p>
            </div>
            <div className="confirm-foot">
              <button className="btn" onClick={() => setConfirmClear(false)}>取消</button>
              <button className="btn danger-solid" onClick={() => void doClear()}>
                <Icon name="trash" size={16} />确认清理
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
