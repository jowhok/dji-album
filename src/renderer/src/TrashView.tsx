import { useCallback, useEffect, useState } from 'react'
import type { TrashRow } from '../../shared/types'
import PurgeConfirm from './PurgeConfirm'
import Icon from './Icon'
import { fmtDateTime, fmtSize } from './format'

interface Props {
  onChanged?: () => void
}

export default function TrashView({ onChanged }: Props) {
  const [rows, setRows] = useState<TrashRow[]>([])
  const [port, setPort] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [purgePaths, setPurgePaths] = useState<string[] | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    void window.api.listTrash().then((r) => {
      setRows(r)
      setSelected(new Set())
      setLoading(false)
    })
  }, [])

  useEffect(load, [load])
  useEffect(() => { void window.api.getMediaPort().then(setPort) }, [])

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function restore() {
    if (selected.size === 0) return
    setBusy(true)
    const r = await window.api.restore([...selected])
    setMsg(r.ok ? `已恢复 ${selected.size} 个媒体` : `恢复失败：${r.error}`)
    setBusy(false)
    load()
    onChanged?.()
  }

  const base = `http://127.0.0.1:${port}`

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-title">
          回收站 · {rows.length} 个媒体
        </div>
        <div className="toolbar-actions">
          <button className="btn" disabled={rows.length === 0} onClick={() => setSelected(new Set(selected.size === rows.length ? [] : rows.map((r) => r.path)))}>
            <Icon name="checkSquare" size={16} />
            {selected.size === rows.length && rows.length > 0 ? '取消全选' : '全选'}
          </button>
          <button className="btn" onClick={load}><Icon name="refresh" size={16} />刷新</button>
          <button className="btn primary" disabled={selected.size === 0 || busy} onClick={() => void restore()}>
            <Icon name="restore" size={16} />
            {busy ? '处理中…' : `恢复选中 (${selected.size})`}
          </button>
          <button
            className="btn danger"
            disabled={selected.size === 0 || busy}
            onClick={() => setPurgePaths([...selected])}
          >
            <Icon name="trash" size={16} />彻底删除 ({selected.size})
          </button>
        </div>
      </div>
      <div className="content">
        <div className="hint-text">
          这里只是本地软删除记录，NAS 原文件未被改动。恢复后媒体会重新出现在时光轴；「彻底删除」会真实删除 NAS 上的原片与同名 LRF 代理，执行前需二次确认。
        </div>
        {msg && <div className="hint-text">{msg}</div>}
        {loading ? (
          <div className="empty-state">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">回收站是空的</div>
        ) : (
          <div className="trash-grid">
            {rows.map((r) => (
              <div
                key={r.path}
                className={`trash-card ${selected.has(r.path) ? 'selected' : ''}`}
                onClick={() => toggle(r.path)}
                title={r.path}
              >
                <div className="trash-media">
                  {r.thumb && port ? (
                    <img src={`${base}/thumb/${r.thumb}`} decoding="async" alt={r.name} />
                  ) : (
                    <div className="tile-placeholder" style={{ aspectRatio: '16 / 9' }}>无缩略图</div>
                  )}
                  <span className={`check-box ${selected.has(r.path) ? 'on' : ''}`}>
                    {selected.has(r.path) ? '✓' : ''}
                  </span>
                </div>
                <div className="trash-cap">
                  <span className="tile-name">{r.name}</span>
                  <span>{fmtSize(r.size)} · {r.type === 'video' ? '视频' : '照片'}</span>
                  <span>删除于 {fmtDateTime(r.deleted_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {purgePaths && (
        <PurgeConfirm
          paths={purgePaths}
          onClose={() => { setPurgePaths(null); load() }}
          onDone={load}
        />
      )}
    </>
  )
}
