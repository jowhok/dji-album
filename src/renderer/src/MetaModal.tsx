import { useEffect, useState } from 'react'
import type { MediaMeta } from '../../shared/types'
import Icon from './Icon'
import { fmtDate, fmtDateTime, fmtDuration, fmtSize } from './format'

interface Props {
  path: string
  onClose: () => void
}

export default function MetaModal({ path, onClose }: Props) {
  const [meta, setMeta] = useState<MediaMeta | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    void window.api.getMeta(path).then((r) => {
      if (!alive) return
      if (r.ok && r.data) setMeta(r.data)
      else setError(r.error ?? '读取元数据失败')
    })
    return () => { alive = false }
  }, [path])

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const fields: Array<[string, string]> = meta
    ? [
        ['文件名', meta.name],
        ['类型', meta.type === 'video' ? '视频' : '照片'],
        ...(meta.type === 'video'
          ? ([
              ['时长', fmtDuration(meta.duration)],
              ['帧率', meta.fps != null ? `${meta.fps} fps` : '—'],
              ['视频编码', meta.vcodec ?? '—'],
              ['音频编码', meta.acodec ?? '—'],
              ['码率', meta.bitrate != null ? `${meta.bitrate} kb/s` : '—']
            ] as Array<[string, string]>)
          : []),
        ['分辨率', meta.width && meta.height ? `${meta.width} × ${meta.height}` : '—'],
        ['文件大小', fmtSize(meta.size)],
        ['拍摄时间', fmtDateTime(meta.taken_at)],
        ['日期目录', fmtDate(meta.dir_date)],
        ['LRF 代理', meta.lrf_path ? `${meta.lrf_path.split(/[\\/]/).pop()} · ${fmtSize(meta.lrf_size)}` : '无'],
        ['文件状态', meta.exists ? 'NAS 上可访问' : '⚠ NAS 上不可访问'],
        ['完整路径', meta.path]
      ]
    : []

  async function copyPath() {
    if (!meta) return
    await navigator.clipboard.writeText(meta.path)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>媒体元数据</h3>
          <button className="modal-close" onClick={onClose} aria-label="关闭" title="关闭">
            <Icon name="x" size={18} />
          </button>
        </div>
        {error ? (
          <div className="modal-body error-text">{error}</div>
        ) : !meta ? (
          <div className="modal-body hint-text">正在读取元数据（首次可能需要几秒）…</div>
        ) : (
          <div className="modal-body">
            {meta.probe_src === 'lrf' && (
              <div className="meta-warn">
                原片读取失败，以下信息来自 LRF 低码率代理：仅时长/帧率可信，分辨率与码率已隐藏。
              </div>
            )}
            <div className="meta-grid">
              {fields.map(([k, v]) => (
                <div className="meta-row" key={k}>
                  <span className="meta-key">{k}</span>
                  <span className="meta-val" title={v}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="modal-foot">
          <button className="btn" disabled={!meta} onClick={() => void copyPath()}>
            <Icon name={copied ? 'check' : 'copy'} size={16} />
            {copied ? '已复制' : '复制完整路径'}
          </button>
          <button className="btn primary" onClick={onClose}><Icon name="x" size={16} />关闭</button>
        </div>
      </div>
    </div>
  )
}
