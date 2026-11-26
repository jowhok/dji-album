import { useCallback, useEffect, useState } from 'react'
import Onboarding from './Onboarding'
import Timeline from './Timeline'
import TrashView from './TrashView'
import SettingsView from './SettingsView'
import Icon, { type IconName } from './Icon'
import {
  applyTheme, getThemeMode, onSystemThemeChange, resolveTheme, setThemeMode,
  type ThemeMode
} from './theme'

type View = 'timeline' | 'favorites' | 'trash' | 'settings'

const NAV: Array<{ id: View; label: string; icon: IconName }> = [
  { id: 'timeline', label: '时光轴', icon: 'grid' },
  { id: 'favorites', label: '收藏', icon: 'heart' },
  { id: 'trash', label: '回收站', icon: 'trash' },
  { id: 'settings', label: '设置', icon: 'settings' }
]

const THEMES: Array<{ id: ThemeMode; label: string; icon: IconName; tip: string }> = [
  { id: 'light', label: '浅色', icon: 'sun', tip: '始终使用浅色主题' },
  { id: 'dark', label: '深色', icon: 'moon', tip: '始终使用深色主题' },
  { id: 'system', label: '系统', icon: 'monitor', tip: '跟随 Windows 深色/浅色设置' }
]

export default function App() {
  const [booted, setBooted] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [root, setRoot] = useState('')
  const [view, setView] = useState<View>('timeline')
  const [themeMode, setMode] = useState<ThemeMode>(() => getThemeMode())
  const [fullscreen, setFullscreen] = useState(false)
  const [nasOk, setNasOk] = useState<boolean | null>(null)
  const [nasErr, setNasErr] = useState('')
  const [hevc, setHevc] = useState<'checking' | 'ok' | 'unsupported'>('checking')

  useEffect(() => {
    void window.api.getSettings().then(({ settings, root }) => {
      setConfigured(settings.configured === true)
      setRoot(root)
      setBooted(true)
    })
  }, [])

  // 应用主题到 DOM，并同步主进程的原生主题与窗口背景色（避免切换时闪边）
  useEffect(() => {
    const sync = () => {
      const resolved = resolveTheme(themeMode)
      applyTheme(resolved)
      void window.api.setTheme(themeMode, resolved)
    }
    sync()
    return onSystemThemeChange(sync)
  }, [themeMode])

  useEffect(() => {
    void window.api.isFullscreen().then(setFullscreen)
    return window.api.onFullscreenChange(setFullscreen)
  }, [])

  const checkNas = useCallback(() => {
    setNasOk(null)
    void window.api.nasStatus().then((r) => {
      setNasOk(r.ok)
      setNasErr(r.error ?? '')
    })
  }, [])
  useEffect(checkNas, [checkNas])

  // 主动探测 HEVC 解码能力：换机器 / 系统未装 HEVC 扩展时提前提示，而不是等播放失败
  useEffect(() => {
    if (!navigator.mediaCapabilities?.decodingInfo) { setHevc('ok'); return }
    void navigator.mediaCapabilities
      .decodingInfo({
        type: 'file',
        video: {
          contentType: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
          width: 3840,
          height: 2160,
          bitrate: 40_000_000,
          framerate: 30
        }
      })
      .then((r) => setHevc(r.supported ? 'ok' : 'unsupported'))
      .catch(() => setHevc('ok'))
  }, [])

  const changeTheme = (m: ThemeMode) => {
    setThemeMode(m)
    setMode(m)
  }

  const toggleFullscreen = () => {
    void window.api.toggleFullscreen().then(setFullscreen)
  }

  if (!booted) return null
  if (!configured) {
    return (
      <Onboarding
        onDone={(r) => {
          setRoot(r)
          setConfigured(true)
        }}
      />
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo"><Icon name="film" size={19} /> DJI 相册</div>
        <nav className="nav-list">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`nav-item ${view === n.id ? 'active' : ''}`}
              onClick={() => setView(n.id)}
            >
              <Icon name={n.icon} size={17} filled={n.id === 'favorites' && view === n.id} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="spacer" />

        <div className="side-section">
          <div className="side-label">外观</div>
          <div className="theme-switch" role="group" aria-label="主题">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`theme-opt ${themeMode === t.id ? 'active' : ''}`}
                onClick={() => changeTheme(t.id)}
                title={t.tip}
                aria-pressed={themeMode === t.id}
              >
                <Icon name={t.icon} size={15} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="side-action"
            onClick={toggleFullscreen}
            title="切换全屏（F11）"
            aria-pressed={fullscreen}
          >
            <Icon name={fullscreen ? 'compress' : 'expand'} size={16} />
            <span>{fullscreen ? '退出全屏' : '全屏'}</span>
            <span className="side-kbd">F11</span>
          </button>
        </div>

        {hevc === 'unsupported' && (
          <div className="compat-warn" title="本机缺少 HEVC 视频解码器，DJI 的 4K HEVC 视频可能无法播放">
            <Icon name="alert" size={13} /> 本机不支持 HEVC 解码，4K 视频可能无法播放
          </div>
        )}
        <div className={`nas-status${nasOk === false ? ' offline' : ''}`} title={nasErr || root}>
          <Icon name="server" size={13} />
          {nasOk === null ? '检测 NAS…' : nasOk ? 'NAS 已连接' : 'NAS 不可达'}
          {nasOk === false && (
            <button type="button" className="nas-retry" onClick={checkNas}>重试</button>
          )}
          <br />
          <span className="nas-path">{root}</span>
          {nasOk === false && nasErr && <span className="nas-err">{nasErr}</span>}
        </div>
      </aside>
      <main className="main-area">
        {view === 'timeline' && <Timeline key="timeline" />}
        {view === 'favorites' && <Timeline key="favorites" scope="favorites" />}
        {view === 'trash' && <TrashView />}
        {view === 'settings' && (
          <SettingsView
            themeMode={themeMode}
            onThemeChange={changeTheme}
            onRootChange={setRoot}
          />
        )}
      </main>
    </div>
  )
}
