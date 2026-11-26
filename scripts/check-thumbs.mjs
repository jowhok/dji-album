// 缩略图加载性能回归：修复「原生 loading=lazy 在启动阶段被 Chromium 节流挂起近 1 分钟」
const TILES = Number(process.env.DJI_TILES || 369)
const FAV = Number(process.env.DJI_FAV || 2)
const PORT = Number(process.env.CDP_PORT || 9222)
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
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception')
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error')
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
const results = []
const check = (label, pass, detail = '') => {
  results.push({ label, pass: !!pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`)
}

await send('Runtime.enable')
await send('Page.enable')

const info = JSON.parse(await evalJs(`window.api.getAppInfo().then(x => JSON.stringify(x))`))
check('媒体与缓存数量一致', info.files === TILES && info.cacheFiles === TILES && info.thumbMissing === 0,
  JSON.stringify({ files: info.files, cacheFiles: info.cacheFiles, thumbMissing: info.thumbMissing }))

// 服务端响应头：必须带 Content-Length，不能是 chunked
const hash = await evalJs(`(async () => (await window.api.listFiles('all','time'))[0].thumb)()`)
const resp = await fetch(`http://127.0.0.1:${info.mediaPort}/thumb/${hash}`, { method: 'HEAD' })
const cLen = resp.headers.get('content-length')
check('/thumb 带 Content-Length、无 chunked', resp.status === 200 && Number(cLen) > 0 && !resp.headers.get('transfer-encoding'),
  `status=${resp.status} len=${cLen} te=${resp.headers.get('transfer-encoding')}`)

// 图片策略：eager + async decode（原生 lazy 会被节流）
const attrs = JSON.parse(await evalJs(`(() => {
  const im = document.querySelector('.tile img')
  return JSON.stringify(im ? { loading: im.loading, decoding: im.decoding } : null)
})()`) || 'null')
check('卡片图片不使用原生 lazy', attrs && attrs.loading !== 'lazy' && attrs.decoding === 'async', JSON.stringify(attrs))

// 冷 reload：全部缩略图应在 10 秒内 decode 完成（修复前约 86 秒）
// 先等新页面稳定再计时：check-all 会先跑 reload-cdp，紧接着这里又 reload 一次，
// 两次连续 reload 时过早采样会读到「img 已挂载但尚未发起请求」的瞬时 0。
await send('Page.reload', { ignoreCache: true })
const readyExpr = `document.readyState === 'complete' && document.querySelectorAll('.tile img').length === ${TILES}`
let ready = false
for (let i = 0; i < 40; i++) {
  if ((await evalJs(readyExpr)) === true) { ready = true; break }
  await wait(150)
}
const t0 = Date.now()
let loaded = 0
let elapsed = 0
while (Date.now() - t0 < 12000) {
  const n = await evalJs(`(() => {
    const a = [...document.querySelectorAll('.tile img')]
    return a.length === ${TILES} ? a.filter(i => i.naturalWidth > 0).length : -1
  })()`)
  if (typeof n === 'number' && n >= 0) loaded = n
  if (loaded === TILES) { elapsed = Date.now() - t0; break }
  await wait(200)
}
check(`冷加载 ${TILES} 张缩略图 < 10 秒`, ready && loaded === TILES && elapsed < 10000, `${loaded}/${TILES} in ${elapsed || '>12000'}ms`)

const state = JSON.parse(await evalJs(`(async () => JSON.stringify({
  files: (await window.api.listFiles('all','time')).length,
  fav: (await window.api.listFiles('all','time','favorites')).length,
  trash: (await window.api.listTrash()).length,
  broken: [...document.querySelectorAll('.tile img')].filter(i => i.complete && i.naturalWidth === 0).length
}))()`))
check('无破损缩略图', state.broken === 0, String(state.broken))
check(`数据不污染（${TILES} / ${FAV} / 0）`, state.files === TILES && state.fav === FAV && state.trash === 0, JSON.stringify(state))
check('无 JS 异常 / console error', errors.length === 0, errors.slice(0, 3).join(' | ') || '0')

ws.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? `, ${failed.length} FAILED` : ' — ALL PASS'}`)
if (failed.length) process.exit(1)
