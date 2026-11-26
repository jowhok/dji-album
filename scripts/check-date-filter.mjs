// 日期筛选浮层回归：真实鼠标点击，验证「按月分组折叠 + 高度受控 + 筛选生效 + 关闭行为」
const PORT = Number(process.env.CDP_PORT || 9222)
const TILES = Number(process.env.DJI_TILES || 411)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let page = null
for (let i = 0; i < 50; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    page = list.find((t) => t.type === 'page' && t.url.includes('index.html')) ?? list.find((t) => t.type === 'page')
    if (page) break
  } catch { /* 尚未启动 */ }
  await wait(300)
}
if (!page) { console.log(`NO_PAGE: ${PORT} 上没有可用页面`); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let seq = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception')
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error')
})
const send = (method, params = {}) => {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((r) => pending.set(id, r))
}
const ev = async (expr) => {
  const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (m.result?.exceptionDetails) return '__EXCEPTION__'
  return m.result?.result?.value
}
const results = []
const check = (label, pass, detail = '') => {
  results.push({ label, pass: !!pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`)
}
const centerOf = async (sel, nth = 0) => await ev(`(() => {
  const e = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]
  if (!e) return null
  const r = e.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
const click = async (p) => {
  if (!p) return false
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
  return true
}
const esc = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
}

await send('Runtime.enable')
await send('Page.enable')
// 自带 reload：check-all 会先跑 reload-cdp，这里等页面与图片都稳定再开始，避免连续 reload 竞态
await send('Page.reload', { ignoreCache: true })
for (let i = 0; i < 60; i++) {
  if ((await ev(`document.readyState === 'complete' && document.querySelectorAll('.tile img').length === ${TILES} && [...document.querySelectorAll('.tile img')].every(i => i.naturalWidth > 0)`)) === true) break
  await wait(200)
}

// 1) 旧筛选栏已移除，日期按钮在顶部按钮区
const layout = JSON.parse(await ev(`JSON.stringify({
  filterBar: !!document.querySelector('.filter-bar'),
  search: !!document.querySelector('.search-input'),
  favChip: !!document.querySelector('.filter-chip'),
  btnInToolbar: !!document.querySelector('.toolbar-actions .date-filter-btn'),
  label: (document.querySelector('.date-filter-label') || {}).textContent
})`) || 'null')
check('独立筛选栏 / 搜索框 / 仅收藏 已移除',
  !layout || (!layout.filterBar && !layout.search && !layout.favChip), JSON.stringify(layout))
check('日期按钮位于顶部按钮区且默认「全部日期」',
  layout && layout.btnInToolbar && layout.label === '全部日期', JSON.stringify(layout))

// 2) 真实点击打开浮层：高度受控、按月分组、默认只展开一个月
const beforeOpen = await ev(`!!document.querySelector('.date-popover')`)
await click(await centerOf('.date-filter-btn'))
await wait(200)
const pop = JSON.parse(await ev(`(() => {
  const p = document.querySelector('.date-popover')
  if (!p) return null
  const r = p.getBoundingClientRect()
  return JSON.stringify({
    h: Math.round(r.height),
    months: p.querySelectorAll('.date-month-head').length,
    dayOptions: p.querySelectorAll('.date-month .date-option').length,
    scrollMax: getComputedStyle(p.querySelector('.date-popover-scroll')).maxHeight,
    hasAll: !!p.querySelector('.date-option.all'),
    viewport: innerHeight
  })
})()`) || 'null')
check('真实点击 → 浮层打开', !beforeOpen && !!pop, JSON.stringify(pop))
check('浮层高度受控（不铺满屏幕）', pop && pop.h > 0 && pop.h < 400 && pop.h < pop.viewport * 0.7,
  pop ? `h=${pop.h}px max=${pop.scrollMax} viewport=${pop.viewport}` : '')
check('按月份分组且默认只展开一个月', pop && pop.months >= 2 && pop.dayOptions > 0 && pop.dayOptions < 12,
  pop ? `months=${pop.months} 展开的日期项=${pop.dayOptions}` : '')
check('「全部日期」固定项存在', pop && pop.hasAll, '')

// 3) 展开第二个月 → 日期项变多；再收起 → 恢复
const monthsBefore = pop?.dayOptions ?? 0
await click(await centerOf('.date-month-head', 1))
await wait(180)
const monthsExpanded = Number(await ev(`document.querySelectorAll('.date-month .date-option').length`))
check('点击月份标题可展开更多日期', monthsExpanded > monthsBefore, `${monthsBefore} → ${monthsExpanded}`)
await click(await centerOf('.date-month-head', 1))
await wait(180)
const monthsCollapsed = Number(await ev(`document.querySelectorAll('.date-month .date-option').length`))
check('再次点击可收起', monthsCollapsed === monthsBefore, `${monthsExpanded} → ${monthsCollapsed}`)

// 4) 选中某一天 → 只剩该日期分组，按钮显示日期
const picked = await ev(`(() => {
  const e = document.querySelector('.date-month .date-option')
  return e ? e.querySelector('span').textContent.trim() : null
})()`)
await click(await centerOf('.date-month .date-option'))
await wait(300)
const filtered = JSON.parse(await ev(`JSON.stringify({
  popoverGone: !document.querySelector('.date-popover'),
  label: (document.querySelector('.date-filter-label') || {}).textContent,
  groups: document.querySelectorAll('.date-group-head').length,
  tiles: document.querySelectorAll('.tile').length,
  active: !!document.querySelector('.date-filter-btn.is-active')
})`) || 'null')
check('选中日期后浮层关闭且按钮显示该日期',
  filtered && filtered.popoverGone && filtered.active && filtered.label === picked, JSON.stringify(filtered))
check('筛选生效：只剩该日期分组', filtered && filtered.groups === 1 && filtered.tiles > 0 && filtered.tiles < TILES,
  `groups=${filtered?.groups} tiles=${filtered?.tiles}`)

// 5) 切回「全部日期」恢复全量
await click(await centerOf('.date-filter-btn'))
await wait(180)
await click(await centerOf('.date-option.all'))
await wait(300)
const restored = JSON.parse(await ev(`JSON.stringify({
  label: (document.querySelector('.date-filter-label') || {}).textContent,
  tiles: document.querySelectorAll('.tile').length,
  active: !!document.querySelector('.date-filter-btn.is-active')
})`) || 'null')
check('切回「全部日期」恢复全量', restored && restored.label === '全部日期' && restored.tiles === TILES && !restored.active,
  JSON.stringify(restored))

// 6) 外部点击 / Escape 关闭
await click(await centerOf('.date-filter-btn'))
await wait(150)
const outside = await ev(`({ x: 10, y: innerHeight - 10 })`)
await click(outside)
await wait(200)
check('点击外部 → 浮层关闭', !(await ev(`!!document.querySelector('.date-popover')`)), '')
await click(await centerOf('.date-filter-btn'))
await wait(150)
await esc()
await wait(200)
check('Escape → 浮层关闭', !(await ev(`!!document.querySelector('.date-popover')`)), '')

// 7) 缩略图仍全量加载、无 JS 异常、数据不污染
const final = JSON.parse(await ev(`(async () => JSON.stringify({
  imgs: document.querySelectorAll('.tile img').length,
  loaded: [...document.querySelectorAll('.tile img')].filter(i => i.naturalWidth > 0).length,
  files: (await window.api.listFiles('all','time')).length,
  fav: (await window.api.listFiles('all','time','favorites')).length,
  trash: (await window.api.listTrash()).length
}))()`) || 'null')
check('缩略图仍全量加载', final && final.imgs === TILES && final.loaded === TILES, JSON.stringify(final))
check('数据不污染', final && final.files === TILES && final.fav === 2 && final.trash === 0, JSON.stringify(final))
check('无 JS 异常 / console error', errors.length === 0, errors.slice(0, 3).join(' | ') || '0')

ws.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? `, ${failed.length} FAILED` : ' — ALL PASS'}`)
process.exit(failed.length ? 1 : 0)
