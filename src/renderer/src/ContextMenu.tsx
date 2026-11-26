import { useEffect, useRef } from 'react'
import type { MediaRow } from '../../shared/types'
import Icon, { type IconName } from './Icon'

export type MenuAction = 'meta' | 'fav' | 'download' | 'trash'

export interface MenuState {
  x: number
  y: number
  item: MediaRow
}

interface Props {
  state: MenuState
  onClose: () => void
  onAction: (action: MenuAction, item: MediaRow) => void
}

const MENU_W = 232
const MENU_H = 240

const ACTION_ICON: Record<MenuAction, IconName> = {
  meta: 'info',
  fav: 'heart',
  download: 'download',
  trash: 'trash'
}

export default function ContextMenu({ state, onClose, onAction }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const scrollHost = document.querySelector('.content')
    // 只监听 mousedown：真实右键的 mousedown 早于 contextmenu，
    // 在别处右键时会先关闭这里的菜单，再由新卡片的 contextmenu 打开新菜单。
    // 切勿监听 window 的 contextmenu —— React 18 会同步挂载本组件，
    // 打开菜单的那次 contextmenu 冒泡到 window 时会立刻把刚挂载的菜单关掉。
    window.addEventListener('mousedown', outside)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', onClose)
    scrollHost?.addEventListener('scroll', onClose, { passive: true })
    return () => {
      window.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', onClose)
      scrollHost?.removeEventListener('scroll', onClose)
    }
  }, [onClose])

  const x = Math.max(8, Math.min(state.x, window.innerWidth - MENU_W - 8))
  const y = Math.max(8, Math.min(state.y, window.innerHeight - MENU_H - 8))
  const isVideo = state.item.type === 'video'
  const run = (a: MenuAction) => {
    onAction(a, state.item)
    onClose()
  }

  return (
    <div className="ctx-menu" ref={ref} style={{ left: x, top: y }}>
      <div className="ctx-title" title={state.item.name}>{state.item.name}</div>
      <button className="ctx-item" onClick={() => run('meta')}>
        <Icon name={ACTION_ICON.meta} size={16} /><span>查看元数据</span>
      </button>
      <div className="ctx-sep" />
      <button className="ctx-item" onClick={() => run('fav')}>
        <Icon name={ACTION_ICON.fav} size={16} filled={state.item.fav === 1} />
        <span>{state.item.fav === 1 ? '取消收藏' : '加入收藏'}</span>
        <span className="ctx-hint"><Icon name="heart" size={13} filled /></span>
      </button>
      <button className="ctx-item" onClick={() => run('download')}>
        <Icon name={ACTION_ICON.download} size={16} /><span>{isVideo ? '下载原片 (MP4)' : '下载原图 (JPG)'}</span>
      </button>
      <div className="ctx-sep" />
      <button className="ctx-item danger" onClick={() => run('trash')}>
        <Icon name={ACTION_ICON.trash} size={16} /><span>移入回收站</span>
      </button>
      <div className="ctx-foot">NAS 文件不会被真实删除</div>
    </div>
  )
}
