import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'sun' | 'moon' | 'monitor' | 'expand' | 'compress'
  | 'refresh' | 'scan' | 'image' | 'info' | 'heart' | 'download' | 'trash'
  | 'play' | 'pause' | 'volume' | 'volumeOff' | 'rewind' | 'forward'
  | 'chevronLeft' | 'chevronRight' | 'x' | 'copy' | 'check' | 'checkSquare'
  | 'restore' | 'alert' | 'grid' | 'video' | 'photo' | 'clock' | 'sort'
  | 'server' | 'film' | 'settings' | 'database' | 'hardDrive'

const P: Record<IconName, ReactNode> = {
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  expand: <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />,
  compress: <path d="M9 4v4a1 1 0 0 1-1 1H4M15 4v4a1 1 0 0 0 1 1h4M9 20v-4a1 1 0 0 0-1-1H4M15 20v-4a1 1 0 0 1 1-1h4" />,
  refresh: <path d="M20 11a8 8 0 1 0-2 6.5M20 4v7h-7" />,
  scan: <><path d="M3 8V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-3" /><path d="M3 12h18" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  heart: <path d="M12 21s-6.7-4.3-9.3-8C.8 10.2 2 6 5.5 5 7.7 4.4 10 5.4 12 7.6 14 5.4 16.3 4.4 18.5 5 22 6 23.2 10.2 21.3 13c-2.6 3.7-9.3 8-9.3 8z" />,
  download: <path d="M12 3v12M7 11l5 5 5-5M4 20h16" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  play: <path d="M8 5v14l11-7z" />,
  pause: <path d="M9 5v14M15 5v14" />,
  volume: <><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
  volumeOff: <><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M17 9l5 6M22 9l-5 6" /></>,
  rewind: <path d="M12 6 4 12l8 6V6zM20 6l-8 6 8 6V6z" />,
  forward: <path d="M4 6l8 6-8 6V6zM12 6l8 6-8 6V6z" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  check: <path d="m20 6-11 11-5-5" />,
  checkSquare: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m8 12 3 3 5-6" /></>,
  restore: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  alert: <><path d="M12 3 2 20h20L12 3z" /><path d="M12 9v5M12 17h.01" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  video: <><rect x="2" y="5" width="14" height="14" rx="2" /><path d="m22 8-6 4 6 4V8z" /></>,
  photo: <><path d="M3 8h3l2-3h8l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  sort: <path d="M4 6h16M4 12h10M4 18h6" />,
  server: <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01" /></>,
  film: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.7a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.6.76 1.03 1.42 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z" /></>,
  database: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3" /></>,
  hardDrive: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 14h20M6 17h.01M10 17h.01" /></>
}

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  filled?: boolean
}

export default function Icon({ name, size = 16, filled = false, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {P[name]}
    </svg>
  )
}
