import { useEffect, useState } from 'react'
import type { PurgePreview, PurgeResult } from '../../shared/types'
import Icon from './Icon'
import { fmtSize } from './format'

interface Props {
  paths: string[]
  onClose: () => void
  onDone: () => void
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

export default function PurgeConfirm({ paths, onClose, onDone }: Props) {
  const [preview, setPreview] = useState<PurgePreview | null>(null)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PurgeResult | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.purgePreview(paths).then((r) => {
      if (!alive) return
      if (r.ok && r.data) setPreview(r.data)
      else setError(r.error ?? '读取待删清单失败')
    })
    return () => { alive = false }
  }, [paths])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [busy, onClose])

  async function confirm(): Promise<void> {
    if (!checked || busy || !preview) return
    setBusy(true)
    const r = await window.api.purge(paths)
    setBusy(false)
    if (r.ok && r.data) {
      setResult(r.data)
      onDone()
    } else {
      setError(r.error ?? '彻底删除失败')
    }
  }

  const failedItems = result?.items.filter((i) => !i.ok) ?? []

  return (
    <div className="modal-backdrop" onMouseDown={result ? undefined : onClose}>
      <div className="modal purge-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{result ? '彻底删除结果' : '彻底删除确认'}</h3>
          <button className="modal-close" onClick={onClose} aria-label="关闭" title="关闭">
            <Icon name="x" size={18} />
          </button>
        </div>

        {error ? (
          <div className="modal-body error-text">{error}</div>
        ) : result ? (
          <div className="modal-body purge-result">
            <div className="ok">
              已永久删除 <b>{result.succeeded}</b> 个媒体（{fmtSize(result.bytes)}）
              {result.failed > 0 && <>，<span className="bad">{result.failed} 个失败</span></>}
            </div>
            {failedItems.length > 0 && (
              <>
                <div className="hint-text" style={{ paddingTop: 10 }}>
                  以下媒体仍保留在回收站，可稍后重试；已成功删除的文件不会重复处理。
                </div>
                <ul>
                  {failedItems.map((i) =>
                    i.failed.map((f) => (
                      <li key={f.path}>{baseName(f.path)} — {f.error}</li>
                    ))
                  )}
                </ul>
              </>
            )}
          </div>
        ) : !preview ? (
          <div className="modal-body hint-text">正在核对 NAS 上的待删文件…</div>
        ) : (
          <div className="modal-body">
            <div className="purge-warn">
              <strong>⚠️ 此操作非常危险，可能导致不可逆的数据丢失！</strong>
              <div>
                以下文件将从 NAS（小米智能存储）上<b>永久删除</b>，无法从回收站恢复。
                视频会同时删除 MP4 原片与同名 LRF 代理文件。
              </div>
            </div>

            <div className="purge-summary">
              选中 <b>{preview.items.length}</b> 个媒体 · 实际待删 <b>{preview.totalFiles}</b> 个文件 · 合计 <b>{fmtSize(preview.totalBytes)}</b>
            </div>

            {preview.rejected.length > 0 && (
              <div className="purge-reject">
                有 {preview.rejected.length} 项未通过安全校验（不在回收站或路径越界），已自动排除，不会被删除。
              </div>
            )}

            <div className="purge-list">
              {preview.items.map((item) => (
                <div className="purge-item" key={item.path}>
                  <div className="purge-item-head">
                    <span className="purge-badge">{item.type === 'video' ? '视频' : '照片'}</span>
                    <strong title={item.name}>{item.name}</strong>
                    <span>{fmtSize(item.size)}</span>
                  </div>
                  {item.files.map((f) => (
                    <div className="purge-file" key={f.path}>
                      <span className="purge-file-name" title={f.path}>{baseName(f.path)}</span>
                      <span className="purge-file-path" title={f.path}>{f.path}</span>
                      <span className="purge-file-size">{f.exists ? fmtSize(f.size) : '已不存在'}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <label className="purge-check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              我已逐项核对清单，知悉这些文件将从 NAS 永久删除且无法恢复
            </label>
          </div>
        )}

        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={busy}>
            <Icon name="x" size={16} />{result ? '关闭' : '取消'}
          </button>
          {!result && (
            <button
              className="btn danger-solid"
              disabled={!checked || busy || !preview}
              onClick={() => void confirm()}
            >
              <Icon name="alert" size={16} />
              {busy ? '正在删除…' : `永久删除 ${preview?.items.length ?? 0} 个媒体`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
