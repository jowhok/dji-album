import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { MediaRow, ThumbProgress, MetaProgress, SaveProgress } from '../../shared/types'
import ContextMenu, { type MenuAction, type MenuState } from './ContextMenu'
import MetaModal from './MetaModal'
import Player from './Player'
import DateFilter from './DateFilter'
import Icon from './Icon'
import { fmtDate, fmtDuration, fmtSize } from './format'
import { colsForWidth, distributeRows } from './layout'

type Tab = 'all' | 'video' | 'photo'
type Sort = 'time' | 'size'

// 当前数据量一次渲染完更快；超过首批才分批，避免首屏 DOM 与图片请求无限增长
const FIRST_BATCH = 500

interface Props {
  scope?: 'all' | 'favorites'
}

function hashOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

const RATIOS = ['4 / 3', '16 / 9', '3 / 4', '1 / 1']

interface Group {
  dir_date: string
  items: MediaRow[]
}

interface TileProps {
  item: MediaRow
  base: string
  broken: Set<string>
  onBroken: (path: string) => void
  onMenu: (e: ReactMouseEvent, item: MediaRow) => void
  onOpen: (item: MediaRow) => void
}

function Tile({ item, base, broken, onBroken, onMenu, onOpen }: TileProps) {
  const h = hashOf(item.path)
  // 不用原生 loading="lazy"：大量图片在启动/窗口非前台时会被 Chromium 节流挂起近 1 分钟。
  // 缩略图是本地 360px 小图（总量约 8MB），立即加载 + 异步解码更快且可预测。
  const url = item.thumb && !broken.has(item.path) ? `${base}/thumb/${item.thumb}` : ''
  const ratio = RATIOS[h % RATIOS.length]

  return (
    <div
      className="tile"
      title={`${item.name}\n${item.path}\n点击查看/播放 · 右键更多操作`}
      onClick={() => onOpen(item)}
      onContextMenu={(e) => onMenu(e, item)}
    >
      <div className="tile-media">
        {url ? (
          <img src={url} decoding="async" alt={item.name} onError={() => onBroken(item.path)} />
        ) : (
          <div className="tile-placeholder" style={{ aspectRatio: ratio, background: `hsl(${h % 360} 30% 32%)` }}>
            <span>{item.thumb ? '缩略图失效' : '待生成'}</span>
          </div>
        )}
        {item.type === 'video' && (
          <svg className="tile-play" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <circle cx="12" cy="12" r="12" fill="rgba(20,20,19,.55)" />
            <path d="M9 6.5v11l9-5.5z" fill="#fff" />
          </svg>
        )}
        {item.type === 'video' && item.duration != null && (
          <span className="tile-duration">{fmtDuration(item.duration)}</span>
        )}
        {item.fav === 1 && (
          <svg className="tile-heart" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M12 21s-6.7-4.3-9.3-8C.8 10.2 2 6 5.5 5 7.7 4.4 10 5.4 12 7.6 14 5.4 16.3 4.4 18.5 5 22 6 23.2 10.2 21.3 13c-2.6 3.7-9.3 8-9.3 8z" fill="#E24B4A" />
          </svg>
        )}
      </div>
      <div className="tile-cap">
        <span className="tile-name">{item.name}</span>
        <span className="tile-size">{fmtSize(item.size)}</span>
      </div>
    </div>
  )
}

interface RowProps {
  items: MediaRow[]
  cols: number
  base: string
  broken: Set<string>
  onBroken: (path: string) => void
  onMenu: (e: ReactMouseEvent, item: MediaRow) => void
  onOpen: (item: MediaRow) => void
}

function MasonryRow({ items, cols, base, broken, onBroken, onMenu, onOpen }: RowProps) {
  const columns = distributeRows(items, cols)
  return (
    <div className="masonry-row" data-cols={cols}>
      {columns.map((col, ci) => (
        <div className="masonry-col" key={ci}>
          {col.map((f) => (
            <Tile
              key={f.path}
              item={f}
              base={base}
              broken={broken}
              onBroken={onBroken}
              onMenu={onMenu}
              onOpen={onOpen}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export default function Timeline({ scope = 'all' }: Props) {
  const [tab, setTab] = useState<Tab>('all')
  const [sort, setSort] = useState<Sort>('time')
  const [rows, setRows] = useState<MediaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [port, setPort] = useState(0)
  const [cols, setCols] = useState(4)
  const [thumbBusy, setThumbBusy] = useState(false)
  const [thumbProgress, setThumbProgress] = useState<ThumbProgress | null>(null)
  const [thumbMsg, setThumbMsg] = useState('')
  const [metaBusy, setMetaBusy] = useState(false)
  const [metaProgress, setMetaProgress] = useState<MetaProgress | null>(null)
  const [metaMsg, setMetaMsg] = useState('')
  const [saveProgress, setSaveProgress] = useState<SaveProgress | null>(null)
  const [saveMsg, setSaveMsg] = useState('')
  const [toast, setToast] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [metaPath, setMetaPath] = useState<string | null>(null)
  const [playingPath, setPlayingPath] = useState<string | null>(null)
  const [playerExpanded, setPlayerExpanded] = useState(false)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const [date, setDate] = useState('')
  const [visible, setVisible] = useState(FIRST_BATCH)
  const [loadError, setLoadError] = useState('')

  const contentRef = useRef<HTMLDivElement>(null)
  const loadRef = useRef<() => void>(() => {})
  const autoThumbs = useRef(false)
  const autoMeta = useRef(false)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = useCallback((text: string) => {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 3200)
  }, [])

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const load = useCallback(() => {
    setLoading(true)
    setLoadError('')
    void window.api
      .listFiles(tab, sort, scope)
      .then((r) => { setRows(r); setVisible(FIRST_BATCH) })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [tab, sort, scope])
  loadRef.current = load

  const generateThumbs = useCallback(async () => {
    if (thumbBusy) return
    setThumbBusy(true)
    setThumbMsg('正在生成缩略图…')
    try {
      const r = await window.api.generateThumbs()
      setThumbMsg(
        r.ok
          ? `缩略图完成 ${r.done ?? 0}/${r.total ?? 0}，失败 ${r.failed ?? 0}，用时 ${((r.elapsedMs ?? 0) / 1000).toFixed(0)}s`
          : `生成失败: ${r.error}`
      )
      loadRef.current()
    } finally {
      setThumbBusy(false)
    }
  }, [thumbBusy])

  const generateMeta = useCallback(async () => {
    if (metaBusy) return
    setMetaBusy(true)
    setMetaMsg('正在读取元数据…')
    try {
      const r = await window.api.generateMetadata()
      setMetaMsg(
        r.ok
          ? `元数据完成 ${r.done ?? 0}/${r.total ?? 0}，失败 ${r.failed ?? 0}，用时 ${((r.elapsedMs ?? 0) / 1000).toFixed(0)}s`
          : `读取失败: ${r.error}`
      )
      loadRef.current()
    } finally {
      setMetaBusy(false)
    }
  }, [metaBusy])

  useEffect(load, [load])
  useEffect(() => { void window.api.getMediaPort().then(setPort) }, [])
  useEffect(() => window.api.onScanProgress((p) => setScanMsg(`扫描 ${p.current} (${p.done}/${p.total})`)), [])
  useEffect(
    () =>
      window.api.onThumbProgress((p) => {
        setThumbProgress(p)
        if (p.done % 20 === 0) loadRef.current()
      }),
    []
  )
  useEffect(
    () =>
      window.api.onMetaProgress((p) => {
        setMetaProgress(p)
        if (p.done % 30 === 0) loadRef.current()
      }),
    []
  )
  useEffect(() => window.api.onSaveProgress(setSaveProgress), [])

  // 横向瀑布流：按容器宽度决定列数，ResizeObserver 响应窗口变化
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setCols(colsForWidth(entries[0]?.contentRect.width ?? el.clientWidth))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!port || autoThumbs.current || loading || rows.length === 0) return
    if (rows.every((r) => r.thumb)) return
    autoThumbs.current = true
    void generateThumbs()
  }, [port, rows, loading, generateThumbs])

  useEffect(() => {
    if (!port || metaBusy || thumbBusy || autoMeta.current || loading || rows.length === 0) return
    if (!rows.some((r) => r.meta_at === 0)) return
    autoMeta.current = true
    void generateMeta()
  }, [port, rows, loading, thumbBusy, metaBusy, generateMeta])

  async function rescan() {
    setRescanning(true)
    setScanMsg('扫描中…')
    try {
      const r = await window.api.scan()
      setScanMsg(r.ok ? `扫描完成：${r.videos} 视频 / ${r.photos} 照片` : `扫描失败: ${r.error}`)
      if (r.ok) {
        autoMeta.current = false
        load()
      }
    } finally {
      setRescanning(false)
    }
  }

  const onMenu = useCallback((e: ReactMouseEvent, item: MediaRow) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, item })
  }, [])

  const handleAction = useCallback(
    async (action: MenuAction, item: MediaRow) => {
      if (action === 'meta') {
        setMetaPath(item.path)
        return
      }
      if (action === 'fav') {
        const r = await window.api.toggleFav(item.path)
        showToast(r.ok ? (r.data ? '已加入收藏' : '已取消收藏') : `收藏失败：${r.error}`)
        if (r.ok) loadRef.current()
        return
      }
      if (action === 'download') {
        setSaveMsg(`正在下载 ${item.name}…`)
        setSaveProgress(null)
        const r = await window.api.saveAs(item.path)
        if (r.canceled) {
          setSaveMsg('下载已取消')
          showToast('下载已取消')
        } else if (r.ok) {
          setSaveMsg(`已保存到 ${r.path} · ${fmtSize(r.bytes)}`)
          showToast('下载完成')
        } else {
          setSaveMsg(`下载失败：${r.error}`)
          showToast(`下载失败：${r.error}`)
        }
        setSaveProgress(null)
        return
      }
      if (action === 'trash') {
        const r = await window.api.moveToTrash([item.path])
        showToast(r.ok ? '已移入回收站，可在左侧恢复' : `删除失败：${r.error}`)
        if (r.ok) loadRef.current()
      }
    },
    [showToast]
  )

  const openPlayer = useCallback((item: MediaRow) => {
    setPlayerExpanded(false)
    setPlayingPath(item.path)
  }, [])

  const playerAction = useCallback(
    (a: MenuAction, it: MediaRow) => {
      if (a === 'trash') {
        const i = rows.findIndex((r) => r.path === it.path)
        const next = rows[i + 1] ?? rows[i - 1] ?? null
        setPlayingPath(next?.path ?? null)
      }
      void handleAction(a, it)
    },
    [rows, handleAction]
  )

  const playingItem = playingPath ? rows.find((r) => r.path === playingPath) ?? null : null

  const dates = useMemo(() => [...new Set(rows.map((r) => r.dir_date))].sort().reverse(), [rows])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.dir_date, (m.get(r.dir_date) ?? 0) + 1)
    return m
  }, [rows])
  const filtered = useMemo(
    () => (date ? rows.filter((r) => r.dir_date === date) : rows),
    [rows, date]
  )
  const shown = filtered.slice(0, visible)
  const totalByDate = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of filtered) m.set(r.dir_date, (m.get(r.dir_date) ?? 0) + 1)
    return m
  }, [filtered])

  const groups: Group[] = []
  for (const r of shown) {
    const g = groups[groups.length - 1]
    if (g && g.dir_date === r.dir_date) g.items.push(r)
    else groups.push({ dir_date: r.dir_date, items: [r] })
  }
  const base = `http://127.0.0.1:${port}`
  const pct = (done: number, total: number) => `${(done / Math.max(1, total)) * 100}%`

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          {scope === 'favorites' && <span className="view-label">收藏夹</span>}
          <div className="seg">
            <span className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}><Icon name="grid" size={14} />全部</span>
            <span className={tab === 'video' ? 'active' : ''} onClick={() => setTab('video')}><Icon name="video" size={14} />视频</span>
            <span className={tab === 'photo' ? 'active' : ''} onClick={() => setTab('photo')}><Icon name="photo" size={14} />照片</span>
          </div>
          <div className="seg">
            <span className={sort === 'time' ? 'active' : ''} onClick={() => setSort('time')}><Icon name="clock" size={14} />拍摄时间 ↓</span>
            <span className={sort === 'size' ? 'active' : ''} onClick={() => setSort('size')}><Icon name="sort" size={14} />大小 ↓</span>
          </div>
        </div>
        <div className="toolbar-actions">
          <DateFilter
            dates={dates}
            counts={counts}
            value={date}
            onChange={(v) => { setDate(v); setVisible(FIRST_BATCH) }}
          />
          <span className="toolbar-sep" />
          <button className="btn" disabled={metaBusy} onClick={() => void generateMeta()}>
            <Icon name="info" size={16} />{metaBusy ? '读取中…' : '提取元数据'}
          </button>
          <button className="btn" disabled={thumbBusy} onClick={() => void generateThumbs()}>
            <Icon name="image" size={16} />{thumbBusy ? '生成中…' : '生成缩略图'}
          </button>
          <button className="btn" disabled={rescanning} onClick={() => void rescan()}>
            <Icon name="scan" size={16} />{rescanning ? '扫描中…' : '重新扫描'}
          </button>
        </div>
      </div>
      <div className="content" ref={contentRef}>
        {thumbBusy && thumbProgress && (
          <div className="thumb-progress">
            <div className="thumb-progress-text">正在生成缩略图 {thumbProgress.done}/{thumbProgress.total} · 失败 {thumbProgress.failed}</div>
            <div className="progress-bar"><div className="fill" style={{ width: pct(thumbProgress.done, thumbProgress.total) }} /></div>
          </div>
        )}
        {metaBusy && metaProgress && (
          <div className="thumb-progress">
            <div className="thumb-progress-text">正在读取视频元数据 {metaProgress.done}/{metaProgress.total} · 失败 {metaProgress.failed}</div>
            <div className="progress-bar"><div className="fill" style={{ width: pct(metaProgress.done, metaProgress.total) }} /></div>
          </div>
        )}
        {saveProgress && saveProgress.done < saveProgress.total && (
          <div className="thumb-progress">
            <div className="thumb-progress-text">下载中 {fmtSize(saveProgress.done)} / {fmtSize(saveProgress.total)}</div>
            <div className="progress-bar"><div className="fill" style={{ width: pct(saveProgress.done, saveProgress.total) }} /></div>
          </div>
        )}
        {scanMsg && <div className="hint-text">{scanMsg}</div>}
        {thumbMsg && !thumbBusy && <div className="hint-text">{thumbMsg}</div>}
        {metaMsg && !metaBusy && <div className="hint-text">{metaMsg}</div>}
        {saveMsg && !saveProgress && <div className="hint-text">{saveMsg}</div>}
        {loadError && (
          <div className="error-banner">
            <Icon name="alert" size={16} />
            <span>索引读取失败：{loadError}</span>
            <button className="btn" onClick={() => load()}>重试</button>
          </div>
        )}
        {loading ? (
          <div className="empty-state">加载中…</div>
        ) : groups.length === 0 ? (
          <div className="empty-state">
            {date
              ? '该日期暂无媒体，点右上角日期按钮可切回「全部日期」'
              : scope === 'favorites'
                ? '还没有收藏的媒体，在时光轴右键即可加入收藏'
                : '暂无媒体，点击右上角「重新扫描」'}
          </div>
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.dir_date}>
                <div className="date-group-head">{fmtDate(g.dir_date)} · {totalByDate.get(g.dir_date) ?? g.items.length} 个媒体</div>
                <MasonryRow
                  items={g.items}
                  cols={cols}
                  base={base}
                  broken={broken}
                  onBroken={(p) => setBroken((prev) => new Set(prev).add(p))}
                  onMenu={onMenu}
                  onOpen={openPlayer}
                />
              </section>
            ))}
            {visible < filtered.length && (
              <div className="load-more">
                <button className="btn" onClick={() => setVisible((v) => v + FIRST_BATCH)}>
                  加载更多（已显示 {shown.length} / {filtered.length}）
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} onAction={(a, i) => void handleAction(a, i)} />}
      {metaPath && <MetaModal path={metaPath} onClose={() => setMetaPath(null)} />}
      {toast && <div className="toast">{toast}</div>}
      {playingItem && (
        <Player
          key={playingItem.path}
          item={playingItem}
          rows={rows}
          base={base}
          expanded={playerExpanded}
          onExpandedChange={setPlayerExpanded}
          onClose={() => { setPlayerExpanded(false); setPlayingPath(null) }}
          onNavigate={setPlayingPath}
          onAction={playerAction}
        />
      )}
    </>
  )
}
