import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import { fmtDate } from './format'

interface MonthGroup {
  month: string
  label: string
  total: number
  days: string[]
}

interface Props {
  dates: string[] // 已倒序，YYYYMMDD
  counts: Map<string, number>
  value: string // '' = 全部日期
  onChange: (value: string) => void
}

// 原生 <select> 的弹出层高度不受 CSS 控制，日期一多会铺满屏幕。
// 改为受控浮层：按月份分组、默认只展开最近一个月、整体限高滚动。
export default function DateFilter({ dates, counts, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string> | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const groups = useMemo<MonthGroup[]>(() => {
    const map = new Map<string, MonthGroup>()
    for (const d of dates) {
      const month = d.slice(0, 6)
      let g = map.get(month)
      if (!g) {
        g = { month, label: `${month.slice(0, 4)}-${month.slice(4, 6)}`, total: 0, days: [] }
        map.set(month, g)
      }
      g.days.push(d)
      g.total += counts.get(d) ?? 0
    }
    return [...map.values()]
  }, [dates, counts])

  const total = useMemo(() => dates.reduce((n, d) => n + (counts.get(d) ?? 0), 0), [dates, counts])

  // 首次打开只展开「当前选中 / 最近」一个月，从根上避免列表过长
  useEffect(() => {
    if (!open) return
    setExpanded((prev) => {
      if (prev !== null) return prev
      const active = value ? value.slice(0, 6) : groups[0]?.month
      return new Set(active ? [active] : [])
    })
  }, [open, value, groups])

  // 外部点击 / Esc 关闭。用 mousedown（早于按钮的 click），避免同一次点击打开后立即自关闭。
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggleMonth = (m: string) =>
    setExpanded((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })

  const pick = (v: string) => { onChange(v); setOpen(false) }

  return (
    <div className="date-filter" ref={rootRef}>
      <button
        type="button"
        className={`btn date-filter-btn${value ? ' is-active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="按拍摄日期筛选"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="clock" size={15} />
        <span className="date-filter-label">{value ? fmtDate(value) : '全部日期'}</span>
        <Icon name="chevronRight" size={12} className={`date-filter-caret${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="date-popover" role="listbox">
          <button
            type="button"
            className={`date-option all${value === '' ? ' selected' : ''}`}
            onClick={() => pick('')}
          >
            <span>全部日期</span>
            <span className="date-option-count">{total}</span>
          </button>
          <div className="date-popover-scroll">
            {groups.map((g) => (
              <div className="date-month" key={g.month}>
                <button
                  type="button"
                  className="date-month-head"
                  aria-expanded={expanded?.has(g.month) ?? false}
                  onClick={() => toggleMonth(g.month)}
                >
                  <Icon name="chevronRight" size={11} className={`date-filter-caret${expanded?.has(g.month) ? ' open' : ''}`} />
                  <span>{g.label}</span>
                  <span className="date-option-count">{g.total}</span>
                </button>
                {(expanded?.has(g.month) ?? false) && g.days.map((d) => (
                  <button
                    type="button"
                    key={d}
                    className={`date-option${value === d ? ' selected' : ''}`}
                    onClick={() => pick(d)}
                  >
                    <span>{fmtDate(d)}</span>
                    <span className="date-option-count">{counts.get(d) ?? 0}</span>
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && <div className="date-empty">暂无日期</div>}
          </div>
        </div>
      )}
    </div>
  )
}
