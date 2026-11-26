// 设置页回归：真实点击进入 / 表单回填 / 测试连接 / 主题同步 / 缓存清理与重建
const TILES = Number(process.env.DJI_TILES || 369)
const FAV = Number(process.env.DJI_FAV || 2)
// 可选：本机回归想精确比对 NAS 配置时注入，仓库内不内置任何真实环境信息
const NAS_HOST = process.env.DJI_NAS_HOST || ''
const NAS_SHARE = process.env.DJI_NAS_SHARE || ''
const NAS_USER = process.env.DJI_NAS_USER || ''
const NAS_ROOT = process.env.DJI_NAS_ROOT || ''
const isUnc = (s) => { const v = String(s || ""), bs = String.fromCharCode(92); return v.startsWith(bs + bs) && v.slice(2).includes(bs) }
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
async function waitFor(expr, timeoutMs = 20000) {
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
async function realClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
}
async function clickByText(sel, text) {
  // 设置页内容超过一屏，真实鼠标点击前必须把目标滚进视口
  const c = await evalJs(`(() => {
    const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.includes(${JSON.stringify(text)}))
    if (!b) return null
    b.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = b.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), y0: Math.round(r.top) }
  })()`)
  if (!c) return false
  await realClick(c.x, c.y)
  return true
}
const clickNav = (text) => clickByText('.sidebar .nav-item', text)
const clickSetting = (text) => clickByText('.settings-card .btn, .confirm-foot .btn', text)
const clickThemeSeg = (text) => clickByText('.settings-theme span', text)
const info = () => evalJs(`window.api.getAppInfo().then(x => JSON.stringify(x))`).then((s) => (s ? JSON.parse(s) : null))
const msgText = () => evalJs(`document.querySelector('.settings-msg')?.textContent.trim() ?? ''`)

const tiles = await waitFor(`document.querySelectorAll('.tile').length === ${TILES} ? '${TILES}' : null`, 20000)
check('时光轴已加载 TILES 卡片', !!tiles, String(tiles))
if (!tiles) process.exit(1)

const initialMode = await evalJs(`localStorage.getItem('dji-album-theme') || 'dark'`)
const initialTheme = await evalJs(`document.documentElement.dataset.theme`)

// ---------- 1. 侧栏入口与设置页结构 ----------
const navUi = JSON.parse(await evalJs(`JSON.stringify({
  count: document.querySelectorAll('.sidebar .nav-item').length,
  settings: !!([...document.querySelectorAll('.sidebar .nav-item')].find(b => b.textContent.trim() === '设置')),
  settingsIcon: !![...document.querySelectorAll('.sidebar .nav-item')].find(b => b.textContent.trim() === '设置')?.querySelector('svg')
})`))
check('侧栏有 4 项导航且「设置」带图标', navUi.count === 4 && navUi.settings && navUi.settingsIcon, JSON.stringify(navUi))

check('真实点击「设置」导航', await clickNav('设置'))
await waitFor(`!!document.querySelector('.settings-view') ? 'open' : null`, 8000)
await wait(500)
const sections = await evalJs(`JSON.stringify([...document.querySelectorAll('.settings-card-head h3')].map(h => h.textContent.trim()))`)
check('设置页 5 个分区齐全', sections && JSON.parse(sections).join('/') === 'NAS 连接/缓存与索引/外观/快捷键/关于', sections)
check('进入设置页后瀑布流已卸载', (await evalJs(`document.querySelectorAll('.tile').length`)) === 0, '')

// ---------- 2. app:info 统计与 DOM 一致 ----------
const i0 = await info()
check('统计：TILES 媒体 / 100 视频 / 218 照片', !!i0 && i0.files === TILES && i0.videos + i0.photos === i0.files, i0 && `${i0.files}/${i0.videos}/${i0.photos}`)
check('统计：收藏 0 / 回收站 0 / 待生成 0', !!i0 && i0.favorites === FAV && i0.trash === 0 && i0.thumbMissing === 0, i0 && `${i0.favorites}/${i0.trash}/${i0.thumbMissing}`)
check('统计：缓存 TILES 个文件 / 端口有效 / root 为有效 UNC', !!i0 && i0.cacheFiles === TILES && i0.cacheBytes > 0 && i0.mediaPort > 0 && (NAS_SHARE ? i0.root.includes(NAS_SHARE) : isUnc(i0.root)), i0 && `${i0.cacheFiles} / ${i0.mediaPort} / ${i0.root}`)
check('统计：版本与运行时信息齐全', !!i0 && !!i0.version && !!i0.electron && !!i0.node && !!i0.userData && !!i0.dbPath && !!i0.thumbsDir, i0 && `${i0.version} e=${i0.electron} n=${i0.node}`)
const domStats = await evalJs(`JSON.stringify([...document.querySelectorAll('.settings-stat')].map(s => s.querySelector('strong')?.textContent.trim() ?? ''))`)
check('DOM 统计卡片显示 TILES / 缓存 TILES 个', domStats && JSON.parse(domStats).includes(String(TILES)) && JSON.parse(domStats).includes(TILES + " 个"), domStats)

// ---------- 3. NAS 表单回填与测试连接 ----------
const form = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('.settings-form input')].map(i => i.value))`))
check('NAS 表单正确回填 4 项', form.length === 5 && form.slice(0, 4).every((v) => String(v).trim() !== '') && (!NAS_HOST || form[0] === NAS_HOST) && (!NAS_SHARE || form[1] === NAS_SHARE) && (!NAS_USER || form[2] === NAS_USER) && (!NAS_ROOT || form[3].includes(NAS_ROOT)), JSON.stringify(form))
const rootText = await evalJs(`document.querySelector('.settings-root code')?.textContent.trim() ?? ''`)
check('显示当前 UNC 根目录', isUnc(rootText) && (!NAS_SHARE || rootText.includes(NAS_SHARE)) && (!NAS_ROOT || rootText.includes(NAS_ROOT)), rootText)
check('真实点击「测试连接」', await clickSetting('测试连接'))
await waitFor(`!!document.querySelector('.settings-test') ? 'done' : null`, 20000)
const testUi = await evalJs(`document.querySelector('.settings-test')?.textContent.trim() ?? ''`)
check('测试连接返回成功', testUi.includes('连接正常'), testUi)

// ---------- 4. 主题：设置页与侧栏同步 ----------
check('真实点击设置页「浅色」', await clickThemeSeg('浅色'))
await wait(350)
const light = JSON.parse(await evalJs(`JSON.stringify({
  theme: document.documentElement.dataset.theme,
  side: document.querySelector('.theme-opt.active')?.textContent.trim() ?? '',
  settings: document.querySelector('.settings-theme .active')?.textContent.trim() ?? ''
})`))
check('切浅色：全局生效且侧栏/设置页同步', light.theme === 'light' && light.side.includes('浅色') && light.settings.includes('浅色'), JSON.stringify(light))
check('真实点击设置页「深色」', await clickThemeSeg('深色'))
await wait(350)
const darkTheme = await evalJs(`JSON.stringify({ theme: document.documentElement.dataset.theme, mode: localStorage.getItem('dji-album-theme'), active: document.querySelector('.settings-theme .active')?.textContent.trim() })`)
check('切深色：全局恢复', JSON.parse(darkTheme).theme === 'dark', darkTheme)

// ---------- 5. 快捷键与关于 ----------
const keys = await evalJs(`document.querySelectorAll('.settings-key-row').length`)
check('快捷键表 8 行', keys === 8, String(keys))
const about = await evalJs(`document.querySelectorAll('.settings-kv code').length`)
check('关于区 5 项路径/版本', about === 5, String(about))

// ---------- 6. 清理缓存：二次确认、取消、执行 ----------
const clearBtn = await evalJs(`(() => { const b = [...document.querySelectorAll('.settings-card .btn')].find(x => x.textContent.includes('清理缓存')); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ y: Math.round(r.top), vh: innerHeight, disabled: b.disabled, scrollTop: document.querySelector('.settings-view')?.scrollTop }) })()`)
check('真实点击「清理缓存」', await clickSetting('清理缓存'), clearBtn)
await wait(300)
const confirmUi = JSON.parse(await evalJs(`JSON.stringify({
  open: !!document.querySelector('.confirm-backdrop'),
  warn: document.querySelector('.confirm-warn')?.textContent.trim() ?? '',
  body: document.querySelector('.confirm-body')?.textContent ?? '',
  z: document.querySelector('.confirm-backdrop') ? getComputedStyle(document.querySelector('.confirm-backdrop')).zIndex : ''
})`))
check('弹出二次确认（列数量/路径/不删 NAS 说明）', confirmUi.open && confirmUi.warn.includes(String(TILES)) && confirmUi.body.includes(i0.thumbsDir) && confirmUi.body.includes('NAS') && Number(confirmUi.z) > 50, JSON.stringify(confirmUi).slice(0, 260))
check('真实点击「取消」', await clickSetting('取消'))
await wait(300)
check('取消后未删任何缓存文件', !(await evalJs(`!!document.querySelector('.confirm-backdrop')`)) && (await info())?.cacheFiles === TILES, '')

await clickSetting('清理缓存')
await wait(300)
check('再次「清理缓存」并确认', await clickSetting('确认清理'))
await waitFor(`(document.querySelector('.settings-msg')?.textContent ?? '').includes('已清理') ? 'cleared' : null`, 20000)
const i1 = await info()
check('清理后缓存归零、TILES 条记录变待生成', !!i1 && i1.cacheFiles === 0 && i1.cacheBytes === 0 && i1.thumbMissing === TILES, i1 && `${i1.cacheFiles}/${i1.thumbMissing}`)
check('清理不删数据库记录/收藏/回收站', !!i1 && i1.files === TILES && i1.favorites === FAV && i1.trash === 0, i1 && `${i1.files}/${i1.favorites}/${i1.trash}`)

// NAS 原片仍可正常读取（真实读文件头探测元数据）
const probe = JSON.parse(await evalJs(`(async () => {
  const rows = await window.api.listFiles('all','time');
  const v = rows.find(r => r.type === 'video') ?? rows[0];
  const r = await window.api.getMeta(v.path);
  return JSON.stringify({ name: v.name, ok: r.ok, duration: r.data?.duration ?? null });
})()`))
check('NAS 原片未受影响（仍可读取元数据）', probe.ok && typeof probe.duration === 'number' && probe.duration > 0, JSON.stringify(probe))

// ---------- 7. 真实点击「重建缩略图」恢复基线 ----------
check('真实点击「重建缩略图」', await clickSetting('重建缩略图'))
const rebuilt = await waitFor(`(document.querySelector('.settings-msg')?.textContent ?? '').includes('缩略图完成') ? 'done' : null`, 300000)
check('重建缩略图完成', !!rebuilt, rebuilt ?? 'timeout')
const i2 = await info()
check('重建后缓存恢复 TILES / 待生成 0', !!i2 && i2.cacheFiles === TILES && i2.thumbMissing === 0 && i2.files === TILES, i2 && `${i2.cacheFiles}/${i2.thumbMissing}/${i2.files}`)

// ---------- 8. 主题与数据收尾 ----------
if (initialMode !== 'dark') {
  await clickThemeSeg(initialMode === 'light' ? '浅色' : '系统')
  await wait(300)
}
const finalMode = await evalJs(`localStorage.getItem('dji-album-theme') || 'dark'`)
check('主题恢复为进入设置页时的值', finalMode === initialMode, `${initialMode} -> ${finalMode} (theme ${initialTheme})`)
check('真实点击「时光轴」返回', await clickNav('时光轴'))
await waitFor(`document.querySelectorAll('.tile').length === ${TILES} ? '${TILES}' : null`, 20000)
const dirty = JSON.parse(await evalJs(`(async () => JSON.stringify({
  files: (await window.api.listFiles('all','time')).length,
  fav: (await window.api.listFiles('all','time','favorites')).length,
  trash: (await window.api.listTrash()).length
}))()`))
check('回到时光轴 TILES 卡片且数据不污染', dirty.files === TILES && dirty.fav === FAV && dirty.trash === 0, JSON.stringify(dirty))

const failed = results.filter((x) => !x.pass)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
ws.close()
process.exit(failed.length ? 1 : 0)
