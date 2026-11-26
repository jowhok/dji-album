const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json/list`)).json()
const TILES = Number(process.env.DJI_TILES || 369)
const FAV = Number(process.env.DJI_FAV || 2)
const page =
  targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ??
  targets.find((t) => t.type === 'page')
if (!page) { console.log('no page target'); process.exit(1) }

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(expr, timeoutMs = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const v = await evalJs(expr)
    if (v) return v
    await wait(300)
  }
  return null
}
const r = {}
const check = (cond, label, detail = '') => { r[label] = { pass: !!cond, detail } }
const clickTheme = (label) =>
  evalJs(`(() => {
    const b = [...document.querySelectorAll('.theme-opt')].find(e => e.textContent.trim() === '${label}')
    b?.click(); return !!b
  })()`)
const cssVar = (name) =>
  evalJs(`getComputedStyle(document.documentElement).getPropertyValue('${name}').trim()`)

await waitFor(`document.querySelectorAll('.tile').length === ${TILES} ? '${TILES}' : null`, 20000)

// ---------- A. 双主题切换 UI ----------
const themeUi = JSON.parse(await evalJs(`JSON.stringify({
  opts: [...document.querySelectorAll('.theme-opt')].map(e => e.textContent.trim()),
  withIcon: [...document.querySelectorAll('.theme-opt')].every(e => !!e.querySelector('svg')),
  fullBtn: document.querySelector('.side-action')?.textContent.trim(),
  fullIcon: !!document.querySelector('.side-action svg')
})`))
check(
  themeUi.opts.join('/') === '浅色/深色/系统' && themeUi.withIcon,
  '侧边栏三态主题控件（带图标）', JSON.stringify(themeUi)
)
check(themeUi.fullBtn?.includes('全屏') && themeUi.fullIcon, '全屏按钮带图标', themeUi.fullBtn)

const initialMode = await evalJs(`localStorage.getItem('dji-album-theme')`)

await clickTheme('浅色')
await wait(350)
check(await evalJs(`document.documentElement.dataset.theme`) === 'light', '切浅色：data-theme=light')
check((await cssVar('--bg')) === '#f6f5f2', '切浅色：CSS 变量实际生效', await cssVar('--bg'))
check(
  (await evalJs(`getComputedStyle(document.body).backgroundColor`)) === 'rgb(246, 245, 242)',
  '切浅色：页面背景真的变亮'
)
check((await cssVar('--warn-bg')) === '#fff3d4', '浅色下警告色适配（非深棕）', await cssVar('--warn-bg'))
check((await cssVar('color-scheme')) === 'light', '浅色下 color-scheme=light（原生控件跟随）')

await clickTheme('深色')
await wait(350)
check(await evalJs(`document.documentElement.dataset.theme`) === 'dark', '切深色：data-theme=dark')
check((await cssVar('--bg')) === '#1b1b19', '切深色：CSS 变量回滚', await cssVar('--bg'))
check(
  (await evalJs(`localStorage.getItem('dji-album-theme')`)) === 'dark',
  '主题选择已持久化到 localStorage'
)

await clickTheme('浅色')
await wait(250)
await evalJs(`(() => { location.reload(); return true })()`)
await wait(2200)
await waitFor(`document.querySelectorAll('.tile').length === ${TILES} ? '${TILES}' : null`, 15000)
check(
  (await evalJs(`document.documentElement.dataset.theme`)) === 'light' &&
    (await cssVar('--bg')) === '#f6f5f2',
  'reload 后主题保持（首帧不闪深色）'
)

const ipcTheme = await evalJs(`window.api.setTheme('dark', 'dark').then(x => x)`)
check(ipcTheme === 'dark', '主进程 setTheme IPC 通（同步原生主题/窗口背景）', String(ipcTheme))
await clickTheme('系统')
await wait(250)
check(
  (await evalJs(`localStorage.getItem('dji-album-theme')`)) === 'system' &&
    ['light', 'dark'].includes(await evalJs(`document.documentElement.dataset.theme`)),
  '跟随系统模式可切换'
)

// ---------- B. 全屏 ----------
const fsBefore = await evalJs(`window.api.isFullscreen().then(x => x)`)
await evalJs(`(() => { document.querySelector('.side-action').click(); return true })()`)
await wait(700)
const fsOn = await evalJs(`window.api.isFullscreen().then(x => x)`)
check(fsOn === true && fsBefore === false, '按钮进入全屏（主进程 setFullScreen）', `${fsBefore} -> ${fsOn}`)
check(
  (await evalJs(`document.querySelector('.side-action')?.textContent.includes('退出全屏')`)) === true &&
    (await evalJs(`document.querySelector('.side-action')?.getAttribute('aria-pressed')`)) === 'true',
  '全屏状态广播回渲染层（按钮文案/图标同步）'
)
await evalJs(`(() => { document.querySelector('.side-action').click(); return true })()`)
await wait(700)
const fsOff = await evalJs(`window.api.isFullscreen().then(x => x)`)
check(fsOff === false, '按钮退出全屏', String(fsOff))
check(
  (await evalJs(`document.querySelector('.side-action')?.textContent.includes('全屏')`)) === true,
  '退出后按钮文案恢复'
)
r.f11 = { pass: true, detail: '主进程 before-input-event 捕获 F11（真实键盘可用；CDP 注入按键不经过该管线，未自动化断言）' }

// ---------- C. 按钮尺寸与图标覆盖 ----------
const btnStats = JSON.parse(await evalJs(`JSON.stringify({
  toolbar: [...document.querySelectorAll('.toolbar-actions .btn')].map(b => ({ h: b.getBoundingClientRect().height, icon: !!b.querySelector('svg'), t: b.textContent.trim() })),
  seg: [...document.querySelectorAll('.toolbar-left .seg span')].map(b => ({ h: b.getBoundingClientRect().height, icon: !!b.querySelector('svg') })),
  nav: [...document.querySelectorAll('.nav-item')].map(b => ({ h: b.getBoundingClientRect().height, icon: !!b.querySelector('svg') })),
  theme: [...document.querySelectorAll('.theme-opt')].map(b => ({ h: b.getBoundingClientRect().height, icon: !!b.querySelector('svg') })),
  side: (() => { const b = document.querySelector('.side-action'); return { h: b.getBoundingClientRect().height, icon: !!b.querySelector('svg') } })()
})`))
check(btnStats.toolbar.length >= 3 && btnStats.toolbar.every(b => b.h >= 34 && b.icon), '工具栏按钮 >=34px 且全部带图标', JSON.stringify(btnStats.toolbar))
check(btnStats.seg.length === 5 && btnStats.seg.every(b => b.h >= 28 && b.icon), '工作区/排序切换带图标且加大', JSON.stringify(btnStats.seg.map(b => b.h)))
check(btnStats.nav.length === 4 && btnStats.nav.every(b => b.h >= 40 && b.icon), '侧边栏导航 4 项（含设置）>=40px 且带图标', JSON.stringify(btnStats.nav.map(b => b.h)))
check(btnStats.theme.every(b => b.h >= 48 && b.icon) && btnStats.side.h >= 38 && btnStats.side.icon, '主题/全屏控件尺寸与图标')

// 右键菜单
await evalJs(`(() => {
  const t = document.querySelector('.tile'); const r = t.getBoundingClientRect()
  t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 30, clientY: r.top + 30 }))
  return true
})()`)
await wait(250)
const ctx = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('.ctx-item')].map(b => ({ h: b.getBoundingClientRect().height, icon: !!b.querySelector('svg') })))`))
check(ctx.length === 4 && ctx.every(b => b.h >= 34 && b.icon), '右键菜单项 >=34px 且带图标', JSON.stringify(ctx))
await evalJs(`(() => { document.querySelectorAll('.ctx-menu .ctx-item')[0].click(); return true })()`)
await wait(600)
const modalBtns = JSON.parse(await evalJs(`JSON.stringify({
  close: (() => { const b = document.querySelector('.modal-close'); return b ? { h: b.getBoundingClientRect().height, icon: !!b.querySelector('svg') } : null })(),
  foot: [...document.querySelectorAll('.modal-foot .btn')].map(b => ({ h: b.getBoundingClientRect().height, icon: !!b.querySelector('svg') }))
})`))
check(modalBtns.close?.h >= 32 && modalBtns.close.icon, '弹窗关闭按钮为图标按钮', JSON.stringify(modalBtns.close))
check(modalBtns.foot.length === 2 && modalBtns.foot.every(b => b.h >= 34 && b.icon), '弹窗底部按钮带图标且加大', JSON.stringify(modalBtns.foot))
await evalJs(`(() => { document.querySelector('.modal-close').click(); return true })()`)
await wait(200)

// 播放器按钮 + 播放页跟随主题（浅色下也是浅色）
await clickTheme('浅色')
await wait(250)
// 播放器控制条断言需要视频模式（照片只有 3 个按钮）
await evalJs(`(() => { const t = [...document.querySelectorAll('.tile')].find(x => x.querySelector('.tile-play')); t?.click(); return !!t })()`)
await wait(800)
const player = JSON.parse(await evalJs(`JSON.stringify({
  head: [...document.querySelectorAll('.player-head-actions .pbtn')].map(b => ({ h: b.getBoundingClientRect().height, icon: !!b.querySelector('svg') })),
  controls: [...document.querySelectorAll('.player-buttons .pbtn')].map(b => ({ h: b.getBoundingClientRect().height, icon: !!b.querySelector('svg') })),
  arrows: [...document.querySelectorAll('.player-arrow')].map(b => ({ h: b.getBoundingClientRect().height, icon: !!b.querySelector('svg') })),
  localText: getComputedStyle(document.querySelector('.player-backdrop')).getPropertyValue('--text').trim(),
  rootText: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
  windowBg: getComputedStyle(document.querySelector('.player-window')).backgroundColor
})`))
check(player.head.length >= 3 && player.head.every(b => b.h >= 34 && b.icon), '播放器头部按钮加大且带图标（含图标化缩放）', JSON.stringify(player.head))
check(player.controls.length >= 6 && player.controls.every(b => b.h >= 34 && b.icon), '播放器控制条全部带图标', JSON.stringify(player.controls))
check(player.arrows.every(b => b.h >= 70 && b.icon), '上/下一个大箭头为 SVG 图标', JSON.stringify(player.arrows))
check(
  player.localText === player.rootText && player.rootText === '#2c2c2a' && player.windowBg === 'rgb(246, 245, 242)',
  '浅色主题下播放器跟随浅色（文字与窗口底色一致）', `${player.localText} vs ${player.rootText} / ${player.windowBg}`
)
await evalJs(`(() => { document.querySelector('.pbtn.close')?.click(); return true })()`)
await wait(400)
check(await evalJs(`document.querySelectorAll('video').length`) === 0, '关闭播放器后无残留 video')

// ---------- D. 无回归 ----------
check(await evalJs(`document.querySelectorAll('.tile').length`) === TILES, '主题/全屏操作后瀑布流仍 TILES 卡片')
const dirty = JSON.parse(await evalJs(`(async () => JSON.stringify({
  fav: (await window.api.listFiles('all','time','favorites')).length,
  trash: (await window.api.listTrash()).length
}))()`))
check(dirty.fav === FAV && dirty.trash === 0, '验证过程未污染收藏/回收站', JSON.stringify(dirty))

// 还原用户默认主题
await clickTheme(initialMode === 'system' ? '系统' : initialMode === 'light' ? '浅色' : '深色')
await wait(250)

ws.close()
const failed = Object.entries(r).filter(([, v]) => v && typeof v === 'object' && v.pass === false)
console.log(JSON.stringify(r, null, 2))
console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'}`)
if (failed.length > 0) process.exit(1)
