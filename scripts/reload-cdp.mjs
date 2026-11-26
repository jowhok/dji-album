// 把当前 CDP 页面 reload 到干净状态，并等到时光轴 TILES 卡片就绪
const TILES = Number(process.env.DJI_TILES || 369)
const FAV = Number(process.env.DJI_FAV || 2)
const PORT = Number(process.env.CDP_PORT || 9222)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let page = null
for (let i = 0; i < 50; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    page =
      targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ??
      targets.find((t) => t.type === 'page')
    if (page) break
  } catch {
    /* 尚未启动 */
  }
  await wait(300)
}
if (!page) { console.log('NO_PAGE'); process.exit(1) }

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
  const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  return m.result?.result?.value
}

await send('Page.enable')
// 打包版后台启动时 document.hidden=true，Chromium 会节流 hidden 页面的图片请求，
// 导致缩略图回归误报 0/N。每个脚本前置刷新时把窗口置前，保证页面 visible。
await send('Page.bringToFront')
await send('Page.reload', { ignoreCache: true })
await send('Page.bringToFront')
let ready = false
for (let i = 0; i < 80; i++) {
  await wait(250)
  try {
    if ((await evalJs(`document.querySelectorAll('.tile').length`)) === TILES) { ready = true; break }
  } catch {
    /* 上下文尚未重建 */
  }
}
console.log(ready ? 'ready: TILES tiles' : 'TIMEOUT waiting for tiles')
ws.close()
process.exit(ready ? 0 : 1)
