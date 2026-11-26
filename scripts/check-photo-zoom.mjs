// 照片预览：滚轮缩放 + 左键拖动 真实输入回归
const TILES = Number(process.env.DJI_TILES || 411)
const FAV = Number(process.env.DJI_FAV || 2)
const PORT = Number(process.env.CDP_PORT || 9222)
// 一律用 CDP Input.dispatchMouseEvent 发真实事件（合成事件会漏掉 passive / pointer capture 时序）
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let page = null
for (let i = 0; i < 50; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    page = targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ?? targets.find((t) => t.type === 'page')
    if (page) break
  } catch { /* 实例尚未启动 */ }
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
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text ?? 'exception')
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error')
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log.error')
})
const send = (method, params = {}) => {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((r) => pending.set(id, r))
}
const evalJs = async (expr) => {
  const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails))
  return m.result?.result?.value
}
const waitFor = async (expr, timeoutMs = 12000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const v = await evalJs(expr)
    if (v) return v
    await wait(250)
  }
  return null
}
const results = []
const check = (label, pass, detail = '') => {
  results.push({ label, pass: !!pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`)
}
const centerOf = (sel) => evalJs(`(() => {
  const e = document.querySelector(${JSON.stringify(sel)})
  if (!e) return null
  const r = e.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }
})()`)

// 读取布局视图（width/height + left/top，不用 transform；基准宽度 = contain 后的宽度）
const view = async () => JSON.parse(await evalJs(`(() => {
  const im = document.querySelector('.player-photo')
  if (!im) return JSON.stringify(null)
  const vp = document.querySelector('.photo-viewport')
  const st = getComputedStyle(im)
  const nw = im.naturalWidth, nh = im.naturalHeight
  const baseW = nw && nh ? Math.min(vp.clientWidth / nw, vp.clientHeight / nh) * nw : 0
  const zoom = baseW ? parseFloat(st.width) / baseW : 1
  return JSON.stringify({ zoom: +zoom.toFixed(3), x: +(parseFloat(st.left) || 0).toFixed(1), y: +(parseFloat(st.top) || 0).toFixed(1) })
})()`) || 'null')

async function wheel(x, y, deltaY) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, button: 'none', buttons: 0 })
  await wait(140)
}
async function drag(x0, y0, dx, dy) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, button: 'none', buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 })
  for (let i = 1; i <= 5; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.round(x0 + dx * i / 5), y: Math.round(y0 + dy * i / 5), button: 'left', buttons: 1
    })
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: x0 + dx, y: y0 + dy, button: 'left', buttons: 0, clickCount: 1
  })
  await wait(140)
}
async function realClick(x, y, button = 'left') {
  const buttons = button === 'left' ? 1 : 2
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 })
}
async function dblClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 2 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 2 })
}
async function esc() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
}
const openPhoto = async () => {
  await evalJs(`(() => {
    const t = [...document.querySelectorAll('.tile')].find(x => !x.querySelector('.tile-play'))
    if (!t) return false
    t.scrollIntoView({ block: 'center' }); t.click(); return true
  })()`)
  // 必须等原图解码完成：clampPan 依赖 naturalWidth/offsetWidth，未解码时边界会被钳成 0
  return await waitFor(`(() => {
    const im = document.querySelector('.player-photo')
    return im && im.complete && im.naturalWidth > 0 ? 'photo' : null
  })()`, 20000)
}
const closePlayer = async () => {
  await evalJs(`(() => { document.querySelector('.pbtn.close')?.click(); return true })()`)
  await wait(350)
}

await send('Runtime.enable')
await send('Log.enable')

// ---------- 1. 打开照片，初始视图 ----------
await send('Page.enable')
await send('Page.reload', { ignoreCache: true })
await wait(2600)
check('打开照片预览', !!(await openPhoto()), '')
check('图片外包 .photo-viewport 且初始 100%', !!(await evalJs(`!!document.querySelector('.player-stage .photo-viewport .player-photo')`)) && (await view())?.zoom === 1, JSON.stringify(await view()))
const v0 = await view()
check('初始无平移', Math.abs(v0.x) < 0.5 && Math.abs(v0.y) < 0.5, JSON.stringify(v0))
check('图片模式提示更新', (await evalJs(`document.querySelector('.player-foot')?.textContent`))?.includes('滚轮 缩放'), '')

const c = await centerOf('.photo-viewport')
// ---------- 2. 真实滚轮缩放 ----------
await wheel(c.x, c.y, -240)
const v1 = await view()
check('真实滚轮向上 → 放大', v1.zoom > 1.15, JSON.stringify(v1))
check('中心滚轮不产生平移', Math.abs(v1.x) < 1 && Math.abs(v1.y) < 1, JSON.stringify(v1))
check('放大时显示倍率浮标', !!(await evalJs(`document.querySelector('.photo-zoom-badge')?.textContent`)), await evalJs(`document.querySelector('.photo-zoom-badge')?.textContent`))

// 偏离中心滚轮：锚点跟随鼠标，应产生平移
const ax = Math.round(c.x + c.w * 0.22), ay = Math.round(c.y - c.h * 0.18)
await wheel(ax, ay, -240)
const v2 = await view()
check('偏离中心滚轮 → 继续放大', v2.zoom > v1.zoom, JSON.stringify({ v1: v1.zoom, v2: v2.zoom }))
check('滚轮锚点跟随鼠标（产生平移）', Math.abs(v2.x) > 2 || Math.abs(v2.y) > 2, JSON.stringify(v2))

await wheel(c.x, c.y, 240)
const v3 = await view()
check('真实滚轮向下 → 缩小', v3.zoom < v2.zoom, JSON.stringify({ v2: v2.zoom, v3: v3.zoom }))

// ---------- 3. 缩回 1 倍自动回中 ----------
for (let i = 0; i < 12; i++) await wheel(c.x, c.y, 300)
const v4 = await view()
check('缩回 100% 且自动回中', v4.zoom === 1 && Math.abs(v4.x) < 0.5 && Math.abs(v4.y) < 0.5, JSON.stringify(v4))
check('1 倍时倍率浮标隐藏', !(await evalJs(`!!document.querySelector('.photo-zoom-badge')`)), '')

// ---------- 4. 左键拖动 ----------
await drag(c.x, c.y, 90, 60)
const v5 = await view()
check('1 倍时拖动被边界约束（不位移）', Math.abs(v5.x) < 0.5 && Math.abs(v5.y) < 0.5, JSON.stringify(v5))
await wheel(c.x, c.y, -400)
const vZoom = await view()
await drag(c.x, c.y, 90, 60)
const v6 = await view()
check('放大后左键拖动产生平移', Math.abs(v6.x - vZoom.x) > 20 || Math.abs(v6.y - vZoom.y) > 20, JSON.stringify({ before: vZoom, after: v6 }))
check('拖动方向正确（右下拖动 → pan 增大）', v6.x >= vZoom.x && v6.y >= vZoom.y, JSON.stringify({ before: vZoom, after: v6 }))
check('拖动不放大/缩小', Math.abs(v6.zoom - vZoom.zoom) < 0.001, `${vZoom.zoom} -> ${v6.zoom}`)
check('拖动不会关闭播放器', !!(await evalJs(`!!document.querySelector('.player-backdrop')`)), '')
check('拖动结束后 cursor 恢复 grab', !(await evalJs(`document.querySelector('.photo-viewport')?.classList.contains('dragging')`)), '')

// ---------- 5. 双击复位 ----------
await dblClick(c.x, c.y)
await wait(220)
const v7 = await view()
check('双击复位到 100% 且回中', v7.zoom === 1 && Math.abs(v7.x) < 0.5 && Math.abs(v7.y) < 0.5, JSON.stringify(v7))

// ---------- 6. 与既有交互共存 ----------
await realClick(Math.round(c.x + c.w * 0.1), c.y, 'right')
await wait(220)
check('图片上右键菜单仍可打开', !!(await evalJs(`!!document.querySelector('.ctx-menu')`)), '')
await esc()
await wait(180)
const nextCenter = await centerOf('.player-arrow.next')
const topEl = await evalJs(`(() => {
  const a = document.querySelector('.player-arrow.next')
  if (!a) return null
  const r = a.getBoundingClientRect()
  const e = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
  return e ? (e.closest('.player-arrow') ? 'arrow' : e.className || e.tagName) : null
})()`)
check('大箭头层级高于图片视口（可点击）', topEl === 'arrow' && !!nextCenter, String(topEl))

// 切到另一个媒体再回来，视图应重置
await closePlayer()
await openPhoto()
const v8 = await view()
check('重新打开照片回到 100%', v8.zoom === 1 && Math.abs(v8.x) < 0.5 && Math.abs(v8.y) < 0.5, JSON.stringify(v8))
await closePlayer()

// 视频模式不应出现图片视口
await evalJs(`(() => {
  const t = [...document.querySelectorAll('.tile')].find(x => !!x.querySelector('.tile-play'))
  if (!t) return false
  t.scrollIntoView({ block: 'center' }); t.click(); return true
})()`)
await waitFor(`!!document.querySelector('.player-stage video') ? 'video' : null`, 12000)
check('视频模式无图片视口', !(await evalJs(`!!document.querySelector('.photo-viewport')`)), '')
await closePlayer()

// ---------- 7. 无异常与数据不污染 ----------
const state = JSON.parse(await evalJs(`(async () => JSON.stringify({
  files: (await window.api.listFiles('all','time')).length,
  fav: (await window.api.listFiles('all','time','favorites')).length,
  trash: (await window.api.listTrash()).length
}))()`))
check(`数据不污染（${TILES} / ${FAV} / 0）`, state.files === TILES && state.fav === FAV && state.trash === 0, JSON.stringify(state))
check('无 JS 异常 / console error', errors.length === 0, errors.slice(0, 3).join(' | ') || '0')

ws.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? `, ${failed.length} FAILED` : ' — ALL PASS'}`)
if (failed.length) process.exit(1)
