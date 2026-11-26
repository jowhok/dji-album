// 播放器浮窗两档（默认 80% / 放大 100%）真实鼠标回归
const TILES = Number(process.env.DJI_TILES || 369)
const FAV = Number(process.env.DJI_FAV || 2)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let page = null
for (let i = 0; i < 50; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json/list`)).json()
    page =
      targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ??
      targets.find((t) => t.type === 'page')
    if (page) break
  } catch {
    /* 实例尚未启动 */
  }
  await wait(300)
}
if (!page) {
  console.log('NO_PAGE: 9222 上没有可用页面')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let seq = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
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
async function waitFor(expr, timeoutMs = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const v = await evalJs(expr)
    if (v) return v
    await wait(300)
  }
  return null
}
const results = []
const check = (label, pass, detail = '') => {
  results.push({ label, pass: !!pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`)
}

async function realClick(x, y, button = 'left') {
  const buttons = button === 'left' ? 1 : 2
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 })
}
const centerOf = (sel) =>
  evalJs(`(() => {
    const e = document.querySelector(${JSON.stringify(sel)})
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)

const state = () =>
  evalJs(`(() => {
    const bd = document.querySelector('.player-backdrop')
    const win = document.querySelector('.player-window')
    if (!bd || !win) return null
    const wr = win.getBoundingClientRect()
    const bs = getComputedStyle(bd), ws = getComputedStyle(win)
    const btns = [...document.querySelectorAll('.player-head-actions .pbtn')]
    const close = btns[btns.length - 1], prev = btns[btns.length - 2]
    const zoom = document.querySelector('.player-head-actions .pbtn.zoom')
    const m = bs.backgroundColor.match(/rgba?\\([^)]*,\\s*([\\d.]+)\\)/)
    return {
      vw: innerWidth, vh: innerHeight,
      w: Math.round(wr.width), h: Math.round(wr.height),
      left: Math.round(wr.left), top: Math.round(wr.top),
      radius: parseFloat(ws.borderTopLeftRadius) || 0,
      bgAlpha: m ? parseFloat(m[1]) : 1,
      blur: bs.backdropFilter || '',
      expanded: bd.classList.contains('is-expanded'),
      zoomLabel: zoom ? (zoom.getAttribute('aria-label') || '') : '',
      zoomText: zoom ? zoom.textContent.trim() : '',
      zoomIcon: zoom ? !!zoom.querySelector('svg') : false,
      headButtons: btns.length,
      closeGap: close && prev ? Math.round(close.getBoundingClientRect().left - prev.getBoundingClientRect().right) : -1,
      videoW: document.querySelector('.player-stage video')?.videoWidth ?? 0,
      photo: !!document.querySelector('.player-stage .player-photo')
    }
  })()`)

const tiles = await waitFor(`document.querySelectorAll('.tile').length === ${TILES} ? '${TILES}' : null`, 20000)
check('时光轴已加载 TILES 卡片', !!tiles, String(tiles))
if (!tiles) process.exit(1)

// 1) 真实左键打开第一个视频
// 选视频卡片并滚进视口：新数据首屏全是照片，第一个视频在下方，真实鼠标点不到
const c1 = await evalJs(`(() => {
  const t = [...document.querySelectorAll('.tile')].find(x => x.querySelector('.tile-play'))
  if (!t) return null
  t.scrollIntoView({ block: 'center', inline: 'nearest' })
  const r = t.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
await wait(250)
await realClick(c1.x, c1.y)
await waitFor(`!!document.querySelector('.player-backdrop') ? 'open' : null`, 8000)
await waitFor(`(document.querySelector('.player-stage video')?.videoWidth ?? 0) > 0 ? 'decoded' : null`, 12000)
await wait(300)
const d = await state()
check('默认浮窗宽 = 80% 窗口宽', d && Math.abs(d.w - d.vw * 0.8) <= 3, d && `${d.w}px / ${d.vw}px`)
check('默认浮窗高 = 80% 窗口高', d && Math.abs(d.h - d.vh * 0.8) <= 3, d && `${d.h}px / ${d.vh}px`)
check('默认居中留白（不占满窗口）', d && d.left > 0 && d.top > 0, d && `left=${d.left} top=${d.top}`)
check('浮窗带圆角 / 边框', d && d.radius > 0, d && `${d.radius}px`)
check('背景半透明（能透出相册）', d && d.bgAlpha < 0.9, d && `alpha=${d.bgAlpha}`)
check('背景毛玻璃', d && d.blur.includes('blur'), d && d.blur)
check('HEVC 仍解码出真实画面', d && d.videoW > 0, d && `${d.videoW}px`)
check('头部有「放大」按钮', d && d.zoomLabel.includes('放大') && !d.expanded, d && `${d.zoomLabel} / buttons=${d.headButtons}`)
check('缩放按钮只有图标、无文字', d && d.zoomText === '' && d.zoomIcon, d && `text="${d.zoomText}" icon=${d.zoomIcon}`)
check('关闭按钮与其它按钮留白 >= 12px', d && d.closeGap >= 12, d && `${d.closeGap}px`)

// 2) 真实点击「放大」→ 铺满窗口（原全屏样子）
const z1 = await centerOf('.player-head-actions .pbtn.zoom')
await realClick(z1.x, z1.y)
await wait(400)
const e = await state()
check('点放大 → 宽铺满窗口', e && Math.abs(e.w - e.vw) <= 3, e && `${e.w}px / ${e.vw}px`)
check('点放大 → 高铺满窗口', e && Math.abs(e.h - e.vh) <= 3, e && `${e.h}px / ${e.vh}px`)
check('放大档无圆角（等同原全屏）', e && e.radius === 0, e && `${e.radius}px`)
check('放大档恢复深色不透明背景', e && e.bgAlpha >= 0.9, e && `alpha=${e.bgAlpha}`)
check('按钮变为「还原」', e && e.zoomLabel.includes('还原') && e.expanded, e && e.zoomLabel)

// 3) 切换媒体后档位保持
const nx = await centerOf('.player-buttons .pbtn:last-child')
if (nx) {
  await realClick(nx.x, nx.y)
  await wait(900)
}
const n = await state()
check('切换媒体后仍保持放大档', n && n.expanded && Math.abs(n.w - n.vw) <= 3, n && `w=${n.w} expanded=${n.expanded}`)

// 4) 真实点击「还原」→ 回到 80%
const z2 = await centerOf('.player-head-actions .pbtn.zoom')
await realClick(z2.x, z2.y)
await wait(400)
const r = await state()
check('点还原 → 回到 80% 浮窗', r && !r.expanded && Math.abs(r.w - r.vw * 0.8) <= 3 && Math.abs(r.h - r.vh * 0.8) <= 3, r && `${r.w}x${r.h}`)

// 5) + 快捷键放大
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '+', code: 'Equal', text: '+', windowsVirtualKeyCode: 187 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '+', code: 'Equal', windowsVirtualKeyCode: 187 })
await wait(400)
const k = await state()
check('+ 快捷键放大到铺满', k && k.expanded, k && `expanded=${k.expanded}`)

// 6) 关闭
const cx = await centerOf('.player-head-actions .pbtn.close')
await realClick(cx.x, cx.y)
await wait(400)
check('关闭按钮关闭播放器', !(await evalJs(`!!document.querySelector('.player-backdrop')`)), '')

// 7) 图片同样走浮窗两档
const opened = await evalJs(`(() => {
  const t = [...document.querySelectorAll('.tile')].find((x) => !x.querySelector('.tile-play'))
  if (!t) return false
  t.scrollIntoView({ block: 'center' })
  t.click()
  return true
})()`)
await waitFor(`!!document.querySelector('.player-stage .player-photo') ? 'photo' : null`, 10000)
await wait(300)
const p = await state()
check('图片默认也是 80% 浮窗', opened && p && p.photo && Math.abs(p.w - p.vw * 0.8) <= 3, p && `photo=${p.photo} ${p.w}x${p.h}`)
check('图片也有放大按钮', p && p.zoomLabel.includes('放大'), p && p.zoomLabel)
const zp = await centerOf('.player-head-actions .pbtn.zoom')
if (zp) { await realClick(zp.x, zp.y); await wait(400) }
const pe = await state()
check('图片可放大到铺满窗口', pe && pe.expanded && Math.abs(pe.w - pe.vw) <= 3, pe && `${pe.w}px / ${pe.vw}px`)
await evalJs(`(() => { document.querySelector('.pbtn.close')?.click(); return true })()`)
await wait(300)

// 8) 数据不被污染
const dirty = JSON.parse(await evalJs(`(async () => JSON.stringify({
  fav: (await window.api.listFiles('all','time','favorites')).length,
  trash: (await window.api.listTrash()).length
}))()`))
check('验证过程未污染收藏/回收站', dirty.fav === FAV && dirty.trash === 0, JSON.stringify(dirty))

const failed = results.filter((x) => !x.pass)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
ws.close()
process.exit(failed.length ? 1 : 0)
