const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json/list`)).json()
const TILES = Number(process.env.DJI_TILES || 369)
const FAV = Number(process.env.DJI_FAV || 2)
const page =
  targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ??
  targets.find((t) => t.type === 'page')
if (!page) { console.log('no page'); process.exit(1) }

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
const nav = (text) =>
  evalJs(`(() => {
    const el = [...document.querySelectorAll('.sidebar .nav-item')].find(e => e.textContent.trim() === '${text}')
    el?.click(); return !!el
  })()`)
const rightClickFirst = () =>
  evalJs(`(() => {
    const t = document.querySelector('.tile'); if (!t) return false
    const r = t.getBoundingClientRect()
    t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 30, clientY: r.top + 30 }))
    return true
  })()`)
const clickMenuItem = (kw) =>
  evalJs(`(() => {
    const it = [...document.querySelectorAll('.ctx-menu .ctx-item')].find(e => e.textContent.includes('${kw}'))
    it?.click(); return !!it
  })()`)

const r = {}
const check = (cond, label, detail = '') => { r[label] = { pass: !!cond, detail } }

// 从右键菜单真实点击「加入收藏」
await rightClickFirst()
await wait(200)
await clickMenuItem('加入收藏')
await wait(500)
r.favToast = await evalJs(`document.querySelector('.toast')?.textContent ?? ''`)
check(r.favToast.includes('已加入收藏'), '菜单点击收藏', r.favToast)

await nav('收藏')
await wait(500)
r.favView = await evalJs(`JSON.stringify({
  label: document.querySelector('.view-label')?.textContent,
  tiles: document.querySelectorAll('.tile').length,
  hearts: document.querySelectorAll('.tile-heart').length
})`)
const fv = JSON.parse(r.favView)
check(fv.label === '收藏夹' && fv.tiles === FAV + 1 && fv.hearts === FAV + 1, '收藏夹视图', r.favView)

// 切回时光轴，从菜单取消收藏（还原）
await nav('时光轴')
await wait(500)
await rightClickFirst()
await wait(200)
await clickMenuItem('取消收藏')
await wait(400)

// 从右键菜单真实点击「移入回收站」
await rightClickFirst()
await wait(200)
await clickMenuItem('回收站')
await wait(600)
r.trashToast = await evalJs(`document.querySelector('.toast')?.textContent ?? ''`)
check(r.trashToast.includes('已移入回收站'), '菜单点击软删', r.trashToast)

await nav('回收站')
await wait(600)
r.trashView = await evalJs(`JSON.stringify({
  cards: document.querySelectorAll('.trash-card').length,
  hint: document.querySelector('.hint-text')?.textContent.slice(0, 40)
})`)
const tv = JSON.parse(r.trashView)
check(tv.cards === 1, '回收站视图显示软删项', r.trashView)

// 勾选 -> 恢复
await evalJs(`(() => { document.querySelector('.trash-card')?.click(); return true })()`)
await wait(200)
await evalJs(`(() => { [...document.querySelectorAll('.toolbar-actions .btn')].find(b => b.textContent.includes('恢复选中'))?.click(); return true })()`)
await wait(700)
r.restored = await evalJs(`JSON.stringify({
  cards: document.querySelectorAll('.trash-card').length,
  empty: document.querySelector('.empty-state')?.textContent ?? ''
})`)
const rs = JSON.parse(r.restored)
check(rs.cards === 0, '回收站可勾选恢复', r.restored)

await nav('时光轴')
await wait(400)
r.finalTiles = await evalJs(`document.querySelectorAll('.tile').length`)
check(r.finalTiles === TILES, '恢复后时光轴回到 TILES', String(r.finalTiles))

ws.close()
const failed = Object.entries(r).filter(([, v]) => v && typeof v === 'object' && v.pass === false)
console.log(JSON.stringify(r, null, 2))
console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'}`)
if (failed.length > 0) process.exit(1)
