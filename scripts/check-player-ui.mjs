// 本轮播放器 UI 优化回归：按钮重排 / 主题跟随 / 播放器内右键菜单
const TILES = Number(process.env.DJI_TILES || 369)
const FAV = Number(process.env.DJI_FAV || 2)
// 一律用 CDP Input.dispatch* 发真实事件（合成事件会漏掉 React 18 同步 effect 时序）
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let page = null
for (let i = 0; i < 50; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json/list`)).json()
    page =
      targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ??
      targets.find((t) => t.type === 'page')
    if (page) break
  } catch { /* 实例尚未启动 */ }
  await wait(300)
}
if (!page) { console.log('NO_PAGE: 9222 上没有可用页面'); process.exit(1) }

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
const realRightClick = (x, y) => realClick(x, y, 'right')
async function esc() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
}
const centerOf = (sel) =>
  evalJs(`(() => {
    const e = document.querySelector(${JSON.stringify(sel)})
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
const centerOfItem = (text) =>
  evalJs(`(() => {
    const e = [...document.querySelectorAll('.ctx-menu .ctx-item')].find(b => b.textContent.includes(${JSON.stringify(text)}))
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
const menuInfo = () =>
  evalJs(`(() => {
    const m = document.querySelector('.ctx-menu')
    if (!m) return null
    const r = m.getBoundingClientRect()
    return {
      visible: r.width > 0 && r.height > 0 && getComputedStyle(m).visibility !== 'hidden',
      items: [...m.querySelectorAll('.ctx-item')].map(b => b.textContent.trim()),
      z: getComputedStyle(m).zIndex
    }
  })()`)

const tiles = await waitFor(`document.querySelectorAll('.tile').length === ${TILES} ? '${TILES}' : null`, 20000)
check('时光轴已加载 TILES 卡片', !!tiles, String(tiles))
if (!tiles) process.exit(1)

const initialTheme = await evalJs(`document.documentElement.dataset.theme`)

// ---------- 1. 真实左键打开第一个视频 ----------
const c1 = await centerOf('.tile')
await realClick(c1.x, c1.y)
await waitFor(`!!document.querySelector('.player-backdrop') ? 'open' : null`, 8000)
await waitFor(`(document.querySelector('.player-stage video')?.videoWidth ?? 0) > 0 ? 'decoded' : null`, 12000)
await wait(300)

// ---------- 2. 头部按钮重排 ----------
const layout = JSON.parse(await evalJs(`JSON.stringify((() => {
  const head = [...document.querySelectorAll('.player-head-actions .pbtn')]
  const ctrl = [...document.querySelectorAll('.player-buttons .pbtn')]
  const zoom = document.querySelector('.player-head-actions .pbtn.zoom')
  const zi = head.findIndex(b => b.classList.contains('zoom'))
  const ci = head.findIndex(b => b.classList.contains('close'))
  const muteIdx = ctrl.findIndex(b => b.textContent.includes('静音'))
  const favIdx = ctrl.findIndex(b => b.classList.contains('fav'))
  return {
    headCount: head.length,
    headTexts: head.map(b => b.textContent.trim()),
    zoomAdjacentToClose: ci === zi + 1,
    zoomText: zoom ? zoom.textContent.trim() : null,
    zoomIcon: zoom ? !!zoom.querySelector('svg') : false,
    zoomLabel: zoom ? zoom.getAttribute('aria-label') : null,
    muteIdx, favIdx, favAdjacentToMute: favIdx === muteIdx + 1,
    favInControls: !!document.querySelector('.player-buttons .pbtn.fav')
  }
})())`))
check('头部只剩 3 个按钮', layout.headCount === 3, JSON.stringify(layout.headTexts))
check('头部已去掉元数据按钮', !layout.headTexts.some((t) => t.includes('元数据')), JSON.stringify(layout.headTexts))
check('头部已去掉收藏按钮', !layout.headTexts.some((t) => t.includes('收藏')), JSON.stringify(layout.headTexts))
check('缩放按钮紧挨关闭按钮', layout.zoomAdjacentToClose, `zoom=${layout.headCount - 2} close=${layout.headCount - 1}`)
check('缩放按钮只有图标、无文字', layout.zoomText === '' && layout.zoomIcon, `text="${layout.zoomText}" icon=${layout.zoomIcon}`)
check('缩放按钮有无障碍标签', (layout.zoomLabel || '').includes('放大'), layout.zoomLabel)
check('收藏按钮在左下角控制条、静音右侧', layout.favInControls && layout.favAdjacentToMute, `mute=${layout.muteIdx} fav=${layout.favIdx}`)

// ---------- 3. 播放页跟随主题 ----------
const colors = () =>
  evalJs(`(() => {
    const win = document.querySelector('.player-window')
    const btn = document.querySelector('.pbtn')
    const bd = document.querySelector('.player-backdrop')
    return {
      windowBg: getComputedStyle(win).backgroundColor,
      btnBg: getComputedStyle(btn).backgroundColor,
      text: getComputedStyle(bd).color,
      localVar: getComputedStyle(bd).getPropertyValue('--text').trim(),
      rootVar: getComputedStyle(document.documentElement).getPropertyValue('--text').trim()
    }
  })()`)
await evalJs(`(() => { document.documentElement.dataset.theme = 'light'; return true })()`)
await wait(250)
const light = await colors()
check('浅色：播放窗口底色为浅色', light.windowBg === 'rgb(246, 245, 242)', JSON.stringify(light))
check('浅色：按钮底色为白色', light.btnBg === 'rgb(255, 255, 255)', light.btnBg)
check('浅色：文字为深色且变量与全局一致', light.text === 'rgb(44, 44, 42)' && light.localVar === light.rootVar, `${light.text} / ${light.localVar} vs ${light.rootVar}`)
await evalJs(`(() => { document.documentElement.dataset.theme = 'dark'; return true })()`)
await wait(250)
const dark = await colors()
check('深色：播放窗口恢复深色', dark.windowBg === 'rgb(27, 27, 25)' && dark.btnBg === 'rgb(42, 42, 40)', JSON.stringify(dark))
await evalJs(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(initialTheme)}; return true })()`)
await wait(200)

// ---------- 4. 播放器内真实右键菜单 ----------
const stage = await centerOf('.player-stage')
await realRightClick(stage.x, stage.y)
await wait(600)
const m1 = await menuInfo()
check('播放器内真实右键 → 菜单稳定可见', !!m1?.visible, JSON.stringify(m1))
check('菜单功能与预览页一致（4 项）', !!m1 && m1.items.length === 4 &&
  m1.items.some((t) => t.includes('查看元数据')) &&
  m1.items.some((t) => t.includes('加入收藏')) &&
  m1.items.some((t) => t.includes('下载')) &&
  m1.items.some((t) => t.includes('移入回收站')), JSON.stringify(m1?.items))
check('菜单层级高于播放器', !!m1 && Number(m1.z) > 50, m1?.z)

// Esc 只关菜单，不关播放器
await esc()
await wait(350)
check('Esc 只关菜单、播放器仍在', !(await evalJs(`!!document.querySelector('.ctx-menu')`)) && !!(await evalJs(`!!document.querySelector('.player-backdrop')`)), '')

// ---------- 5. 菜单 → 查看元数据 ----------
await realRightClick(stage.x, stage.y)
await wait(350)
const metaPos = await centerOfItem('查看元数据')
if (metaPos) await realClick(metaPos.x, metaPos.y)
await wait(500)
const modal = JSON.parse(await evalJs(`JSON.stringify((() => {
  const m = document.querySelector('.modal')
  if (!m) return null
  const r = m.getBoundingClientRect()
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + 20)
  return {
    rows: m.querySelectorAll('.modal-body tr, .modal-body .meta-row').length,
    topmost: !!el && !!el.closest('.modal'),
    z: getComputedStyle(document.querySelector('.modal-backdrop')).zIndex
  }
})())`))
check('菜单「查看元数据」打开弹窗且在播放器之上', !!modal && modal.topmost && Number(modal.z) > 50, JSON.stringify(modal))
await evalJs(`(() => { document.querySelector('.modal-close')?.click(); return true })()`)
await wait(300)
check('元数据弹窗可关闭、播放器仍在', !(await evalJs(`!!document.querySelector('.modal')`)) && !!(await evalJs(`!!document.querySelector('.player-backdrop')`)), '')

// ---------- 6. 菜单 → 收藏（再还原） ----------
await realRightClick(stage.x, stage.y)
await wait(350)
const favPos = await centerOfItem('加入收藏')
if (favPos) await realClick(favPos.x, favPos.y)
await wait(600)
const favState = JSON.parse(await evalJs(`(async () => JSON.stringify({
  favCount: (await window.api.listFiles('all','time','favorites')).length,
  btnOn: !!document.querySelector('.player-buttons .pbtn.fav.on'),
  btnText: document.querySelector('.player-buttons .pbtn.fav')?.textContent.trim() ?? '',
  menuClosed: !document.querySelector('.ctx-menu')
}))()`))
check('菜单「加入收藏」生效且左下角按钮同步', favState.favCount === FAV + 1 && favState.btnOn && favState.btnText.includes('已收藏'), JSON.stringify(favState))
await realRightClick(stage.x, stage.y)
await wait(350)
const unfavPos = await centerOfItem('取消收藏')
if (unfavPos) await realClick(unfavPos.x, unfavPos.y)
await wait(600)
check('菜单「取消收藏」还原', (await evalJs(`(async () => (await window.api.listFiles('all','time','favorites')).length)()`)) === FAV, '')

// ---------- 7. 图片也有左下角收藏按钮 ----------
await evalJs(`(() => { document.querySelector('.pbtn.close')?.click(); return true })()`)
await wait(400)
const openedPhoto = await evalJs(`(() => {
  const t = [...document.querySelectorAll('.tile')].find((x) => !x.querySelector('.tile-play'))
  if (!t) return false
  t.scrollIntoView({ block: 'center' })
  t.click()
  return true
})()`)
await waitFor(`!!document.querySelector('.player-stage .player-photo') ? 'photo' : null`, 10000)
await wait(300)
const photoUi = JSON.parse(await evalJs(`JSON.stringify({
  photo: !!document.querySelector('.player-stage .player-photo'),
  fav: !!document.querySelector('.player-buttons .pbtn.fav'),
  headCount: document.querySelectorAll('.player-head-actions .pbtn').length
})`))
check('图片模式同样有左下角收藏按钮', openedPhoto && photoUi.photo && photoUi.fav && photoUi.headCount === 3, JSON.stringify(photoUi))
await evalJs(`(() => { document.querySelector('.pbtn.close')?.click(); return true })()`)
await wait(300)

// ---------- 8. 数据不污染 ----------
const dirty = JSON.parse(await evalJs(`(async () => JSON.stringify({
  files: (await window.api.listFiles('all','time')).length,
  fav: (await window.api.listFiles('all','time','favorites')).length,
  trash: (await window.api.listTrash()).length,
  theme: document.documentElement.dataset.theme
}))()`))
check('验证过程未污染数据/主题', dirty.fav === FAV && dirty.trash === 0 && dirty.files === TILES && dirty.theme === initialTheme, JSON.stringify(dirty))

const failed = results.filter((x) => !x.pass)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
ws.close()
process.exit(failed.length ? 1 : 0)
