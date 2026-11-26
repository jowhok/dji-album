/** 按容器内容宽度决定瀑布流列数 */
export function colsForWidth(w: number): number {
  if (!isFinite(w) || w <= 0) return 1
  // 4 列阈值 980：侧边栏加宽后 1280 窗口的 contentRect 约 1019px，仍应保持 4 列
  return w >= 980 ? 4 : w >= 760 ? 3 : w >= 500 ? 2 : 1
}

/**
 * 行优先分配：第 0 个进第 1 列、第 1 个进第 2 列……第 cols 个回到第 1 列第二行。
 * 与 CSS columns 的列优先相反，阅读顺序为从左到右。
 */
export function distributeRows<T>(items: T[], cols: number): T[][] {
  const n = Math.max(1, Math.min(8, Math.floor(cols) || 1))
  const out: T[][] = Array.from({ length: n }, () => [])
  items.forEach((it, i) => out[i % n].push(it))
  return out
}
