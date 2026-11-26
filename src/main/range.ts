export type RangeResult = { start: number; end: number } | null | 'invalid'

/** 解析 HTTP Range 头。null = 无 Range（返回 200 全文），'invalid' = 416。纯函数便于单测。 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (!m[1] && !m[2])) return 'invalid'
  if (size <= 0) return 'invalid'

  let start: number
  let end: number
  if (!m[1]) {
    const suffix = parseInt(m[2], 10)
    if (!isFinite(suffix) || suffix <= 0) return 'invalid'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = parseInt(m[1], 10)
    end = m[2] ? parseInt(m[2], 10) : size - 1
    if (end > size - 1) end = size - 1
  }
  if (!isFinite(start) || start < 0 || start > end || start >= size) return 'invalid'
  return { start, end }
}
