import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { MediaRow, MediaUrls } from '../../shared/types'
import ContextMenu, { type MenuAction, type MenuState } from './ContextMenu'
import MetaModal from './MetaModal'
import Icon from './Icon'
import { fmtDate, fmtDuration, fmtSize } from './format'

interface Props {
  item: MediaRow
  rows: MediaRow[]
  base: string
  onClose: () => void
  onNavigate: (path: string) => void
  onAction: (action: MenuAction, item: MediaRow) => void
  expanded: boolean
  onExpandedChange: (v: boolean) => void
}

type Quality = 'smooth' | 'hd'

// 照片视图：zoom 1~8，x/y 为屏幕像素平移（布局属性 left/top，不用 transform）
type PhotoView = { zoom: number; x: number; y: number }
const PHOTO_INIT: PhotoView = { zoom: 1, x: 0, y: 0 }
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export default function Player({ item, rows, base, onClose, onNavigate, onAction, expanded, onExpandedChange }: Props) {
  const [urls, setUrls] = useState<MediaUrls | null>(null)
  const [error, setError] = useState('')
  const [quality, setQuality] = useState<Quality>('smooth')
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(item.duration ?? 0)
  const [muted, setMuted] = useState(false)
  // 元数据弹窗仍由播放器内部持有：右键菜单的「查看元数据」打开它，
  // Esc 时先关弹窗/菜单而不关闭播放器。
  const [showMeta, setShowMeta] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  // 档位由 Timeline 持有：每次重新打开播放器回到 80%，播放中切媒体仍保持
  const setZoom = useCallback((v: boolean) => onExpandedChange(v), [onExpandedChange])
  const videoRef = useRef<HTMLVideoElement>(null)
  const pendingSeek = useRef<number | null>(null)

  // ref 与 state 双写：原生 wheel 监听需要同步读到最新视图值
  const [photoView, setPhotoView] = useState<PhotoView>(PHOTO_INIT)
  const photoViewRef = useRef<PhotoView>(PHOTO_INIT)
  const photoViewportRef = useRef<HTMLDivElement>(null)
  const photoImgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number; zoom: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  // 缩放完全走布局属性：非 none 的 transform 会把 8K 大图提升为合成层，
  // 分块栅格化的 tile 接缝在放大后透出浅色背景，形成规律白线。
  // 改为 width/height + left/top，与瀑布流缩略图同走普通布局栅格化，不再产生合成层。
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = photoViewportRef.current
    const img = photoImgRef.current
    if (!el) return
    // 不依赖 onLoad：缓存图片的 load 可能早于 React 绑定，改成主动读 DOM + load 双保险
    const sync = () => {
      setVpSize({ w: el.clientWidth, h: el.clientHeight })
      if (img?.complete && img.naturalWidth > 0) {
        setNatural({ w: img.naturalWidth, h: img.naturalHeight })
      }
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    img?.addEventListener('load', sync)
    return () => {
      ro.disconnect()
      img?.removeEventListener('load', sync)
    }
  }, [item.path, item.type, urls])
  const fit = natural.w && natural.h && vpSize.w && vpSize.h
    ? Math.min(vpSize.w / natural.w, vpSize.h / natural.h)
    : 0
  const baseW = natural.w * fit
  const baseH = natural.h * fit

  const applyPhotoView = useCallback((v: PhotoView) => {
    photoViewRef.current = v
    setPhotoView(v)
  }, [])

  // 图片放大后不超过视口边界，未超出时不允许拖动
  const clampPan = useCallback((x: number, y: number, zoom: number): { x: number; y: number } => {
    const el = photoViewportRef.current
    if (!el) return { x, y }
    const maxX = Math.max(0, ((baseW || el.clientWidth) * zoom - el.clientWidth) / 2)
    const maxY = Math.max(0, ((baseH || el.clientHeight) * zoom - el.clientHeight) / 2)
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) }
  }, [baseW, baseH])

  // React 的 onWheel 是 passive 监听，preventDefault 无效；必须原生绑定 passive:false
  useEffect(() => {
    const el = photoViewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cur = photoViewRef.current
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - (rect.left + rect.width / 2)
      const my = e.clientY - (rect.top + rect.height / 2)
      const zoom = clamp(cur.zoom * Math.exp(-e.deltaY * 0.0015), 1, 8)
      if (zoom <= 1.001) { applyPhotoView(PHOTO_INIT); return }
      // 保持鼠标下的图片像素不动：x' = m - (zoom'/zoom) * (m - x)
      const ratio = zoom / cur.zoom
      const p = clampPan(mx - ratio * (mx - cur.x), my - ratio * (my - cur.y), zoom)
      applyPhotoView({ zoom, x: p.x, y: p.y })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [urls, applyPhotoView, clampPan])

  const onPhotoPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const cur = photoViewRef.current
    dragRef.current = { startX: e.clientX, startY: e.clientY, x: cur.x, y: cur.y, zoom: cur.zoom }
    setDragging(true)
  }, [])

  const onPhotoPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    const p = clampPan(d.x + e.clientX - d.startX, d.y + e.clientY - d.startY, d.zoom)
    applyPhotoView({ zoom: d.zoom, x: p.x, y: p.y })
  }, [clampPan, applyPhotoView])

  const onPhotoPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
    setDragging(false)
  }, [])

  const index = rows.findIndex((r) => r.path === item.path)
  const hasPrev = index > 0
  const hasNext = index >= 0 && index < rows.length - 1

  useEffect(() => {
    let alive = true
    void window.api.getMediaUrls(item.path, item.lrf_path).then((r) => {
      if (!alive) return
      if (r.ok && r.data) setUrls(r.data)
      else setError(r.error ?? '无法获取媒体地址')
    })
    return () => { alive = false }
  }, [item.path, item.lrf_path])

  const tryPlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    void v.play().catch(() => {
      // 自动播放被策略拦截时静音重试
      v.muted = true
      setMuted(true)
      void v.play().catch(() => {})
    })
  }, [])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) tryPlay()
    else v.pause()
  }, [tryPlay])

  const skip = useCallback((delta: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta))
  }, [])

  const navigate = useCallback(
    (delta: number) => {
      const next = rows[index + delta]
      if (next) onNavigate(next.path)
    },
    [rows, index, onNavigate]
  )

  const switchQuality = useCallback(() => {
    if (!urls?.lrf) return
    pendingSeek.current = videoRef.current?.currentTime ?? 0
    setQuality((q) => (q === 'smooth' ? 'hd' : 'smooth'))
  }, [urls])

  function seek(e: ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value)
    const v = videoRef.current
    if (v) v.currentTime = t
    setCurrent(t)
  }

  function toggleMute() {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }

  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, item })
  }, [item])

  // 元数据用播放器内部弹窗，其余动作与时光轴右键菜单完全一致
  const handleMenuAction = useCallback(
    (a: MenuAction, it: MediaRow) => {
      if (a === 'meta') { setShowMeta(true); return }
      onAction(a, it)
    },
    [onAction]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 菜单/元数据弹窗打开时，Esc 只关它们（ContextMenu / MetaModal 各自监听），不关播放器
      if (showMeta || menu) return
      switch (e.key) {
        case 'Escape': onClose(); break
        case ' ':
          e.preventDefault()
          if (item.type === 'video') togglePlay()
          break
        case 'ArrowLeft': if (item.type === 'video') { e.preventDefault(); skip(-5) } break
        case 'ArrowRight': if (item.type === 'video') { e.preventDefault(); skip(5) } break
        case 'ArrowUp': case 'PageUp': e.preventDefault(); navigate(-1); break
        case 'ArrowDown': case 'PageDown': e.preventDefault(); navigate(1); break
        case 'f': case 'F': if (item.type === 'video') switchQuality(); break
        case '+': case '=': setZoom(true); break
        case '-': case '_': setZoom(false); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showMeta, menu, onClose, item.type, togglePlay, skip, navigate, switchQuality, setZoom])

  // 关闭/切换媒体时停止解码并释放连接
  useEffect(() => {
    return () => {
      const v = videoRef.current
      if (v) {
        v.pause()
        v.removeAttribute('src')
        v.load()
      }
    }
  }, [])

  const src = urls ? `${base}${quality === 'smooth' && urls.lrf ? urls.lrf : urls.mp4}` : ''
  const isVideo = item.type === 'video'

  return (
    <div
      className={`player-backdrop${expanded ? ' is-expanded' : ''}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      onContextMenu={onContextMenu}
    >
      <div className="player-window">
        <div className="player-head">
          <div className="player-title">
            <strong title={item.name}>{item.name}</strong>
            <span>{fmtDate(item.dir_date)} · {fmtSize(item.size)}{isVideo && item.duration != null ? ` · ${fmtDuration(item.duration)}` : ''} · {index + 1}/{rows.length}</span>
          </div>
          <div className="player-head-actions">
            <button className="pbtn danger" onClick={() => onAction('trash', item)}>
              <Icon name="trash" size={16} />移入回收站
            </button>
            <button
              className="pbtn zoom icon-only"
              onClick={() => setZoom(!expanded)}
              title={expanded ? '还原为 80% 浮窗' : '放大铺满窗口 (100%)'}
              aria-label={expanded ? '还原窗口' : '放大窗口'}
              aria-pressed={expanded}
            >
              <Icon name={expanded ? 'compress' : 'expand'} size={16} />
            </button>
            <button className="pbtn close" onClick={onClose} aria-label="关闭" title="关闭 (Esc)">
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        <div className="player-stage">
          {hasPrev && (
            <button className="player-arrow prev" onClick={() => navigate(-1)} title="上一个 (↑)" aria-label="上一个">
              <Icon name="chevronLeft" size={28} />
            </button>
          )}
          {error ? (
            <div className="player-error">
              <div>{error}</div>
              <div className="hint-text">请确认 NAS 可访问；若提示解码失败，可能是本机缺少 HEVC 解码器。</div>
            </div>
          ) : !urls ? (
            <div className="hint-text">正在准备媒体…</div>
          ) : isVideo ? (
            <video
              ref={videoRef}
              src={src}
              autoPlay
              playsInline
              muted={muted}
              onClick={togglePlay}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                setDuration(v.duration || item.duration || 0)
                if (pendingSeek.current != null) {
                  v.currentTime = Math.min(pendingSeek.current, v.duration || pendingSeek.current)
                  pendingSeek.current = null
                }
                tryPlay()
              }}
              onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setError('视频加载或解码失败')}
            />
          ) : (
            <div
              ref={photoViewportRef}
              className={`photo-viewport${dragging ? ' dragging' : ''}`}
              onPointerDown={onPhotoPointerDown}
              onPointerMove={onPhotoPointerMove}
              onPointerUp={onPhotoPointerUp}
              onPointerCancel={onPhotoPointerUp}
              onDoubleClick={() => applyPhotoView(PHOTO_INIT)}
            >
              <img
                ref={photoImgRef}
                className="player-photo"
                src={`${base}${urls.mp4}`}
                alt={item.name}
                draggable={false}
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                style={{
                  width: baseW ? baseW * photoView.zoom : undefined,
                  height: baseH ? baseH * photoView.zoom : undefined,
                  left: photoView.x,
                  top: photoView.y
                }}
              />
              {photoView.zoom > 1.001 && (
                <div className="photo-zoom-badge">{Math.round(photoView.zoom * 100)}%</div>
              )}
            </div>
          )}
          {hasNext && (
            <button className="player-arrow next" onClick={() => navigate(1)} title="下一个 (↓)" aria-label="下一个">
              <Icon name="chevronRight" size={28} />
            </button>
          )}
        </div>

        {!error && (
          <div className="player-controls">
            {isVideo && (
              <div className="player-seek">
                <span className="player-time">{fmtDuration(current)}</span>
                <input
                  type="range"
                  min={0}
                  max={duration || 1}
                  step={0.1}
                  value={Math.min(current, duration || 1)}
                  onChange={seek}
                  aria-label="播放进度"
                />
                <span className="player-time">{fmtDuration(duration)}</span>
              </div>
            )}
            <div className="player-buttons">
              {isVideo && (
                <>
                  <button className="pbtn" onClick={togglePlay}>
                    <Icon name={playing ? 'pause' : 'play'} size={16} filled={!playing} />
                    {playing ? '暂停' : '播放'}
                  </button>
                  <button className="pbtn" onClick={() => skip(-5)}><Icon name="rewind" size={16} />-5s</button>
                  <button className="pbtn" onClick={() => skip(5)}><Icon name="forward" size={16} />+5s</button>
                  <button className="pbtn mute" onClick={toggleMute}>
                    <Icon name={muted ? 'volumeOff' : 'volume'} size={16} />{muted ? '取消静音' : '静音'}
                  </button>
                </>
              )}
              <button
                className={`pbtn fav ${item.fav === 1 ? 'on' : ''}`}
                onClick={() => onAction('fav', item)}
                aria-label={item.fav === 1 ? '取消收藏' : '加入收藏'}
              >
                <Icon name="heart" size={16} filled={item.fav === 1} />
                {item.fav === 1 ? '已收藏' : '收藏'}
              </button>
              <div className="player-spacer" />
              {isVideo && urls?.lrf && (
                <button className="pbtn quality" onClick={switchQuality} title="按 F 切换">
                  <Icon name="refresh" size={16} />{quality === 'smooth' ? '流畅 LRF' : '高清 MP4'}
                </button>
              )}
              <button className="pbtn" disabled={!hasPrev} onClick={() => navigate(-1)}>
                <Icon name="chevronLeft" size={16} />上一个
              </button>
              <button className="pbtn" disabled={!hasNext} onClick={() => navigate(1)}>
                下一个<Icon name="chevronRight" size={16} />
              </button>
            </div>
          </div>
        )}

        <div className="player-foot">
          {isVideo
            ? '空格 播放/暂停 · ←/→ 快退快进 5s · ↑/↓ 上/下一个 · F 切换清晰度 · +/- 放大/还原窗口 · 右键 更多操作 · Esc 关闭'
            : '滚轮 缩放 · 左键拖动 · 双击复位 · ↑/↓ 上/下一个 · +/- 放大/还原窗口 · 右键 更多操作 · Esc 关闭'}
        </div>
      </div>
      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} onAction={handleMenuAction} />}
      {showMeta && <MetaModal path={item.path} onClose={() => setShowMeta(false)} />}
    </div>
  )
}
