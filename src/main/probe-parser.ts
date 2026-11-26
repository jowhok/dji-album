import type { ProbeFields } from '../shared/types'

export const EMPTY_PROBE: ProbeFields = {
  duration: null, width: null, height: null, fps: null,
  vcodec: null, acodec: null, bitrate: null
}

/** 解析 `ffmpeg -i` 的 stderr（不解码，只读容器头）。纯函数，便于单测。 */
export function parseProbeOutput(text: string): ProbeFields {
  const r: ProbeFields = { ...EMPTY_PROBE }
  const lines = text.split(/\r?\n/)

  const dm = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text)
  if (dm) r.duration = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + parseFloat(dm[3])

  const bm = /bitrate:\s*(\d+)\s*kb\/s/.exec(text)
  if (bm) r.bitrate = parseInt(bm[1], 10)

  const vLine = lines.find((l) => /Video:/.test(l)) ?? ''
  if (vLine) {
    const cm = /Video:\s*([^\s,(]+)/.exec(vLine)
    if (cm) r.vcodec = cm[1]
    const rm = /\b(\d{2,5})x(\d{2,5})\b/.exec(vLine)
    if (rm) {
      r.width = Number(rm[1])
      r.height = Number(rm[2])
    }
    const fm = /([\d.]+)\s*fps/.exec(vLine) ?? /([\d.]+)\s*tbr/.exec(vLine)
    if (fm) r.fps = parseFloat(fm[1])
  }

  const aLine = lines.find((l) => /Audio:/.test(l)) ?? ''
  if (aLine) {
    const am = /Audio:\s*([^\s,(]+)/.exec(aLine)
    if (am) r.acodec = am[1]
  }

  return r
}
