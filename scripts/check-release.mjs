/**
 * 打包产物冒烟验证（连到带 --remote-debugging-port 启动的 release exe）
 * 用法：CDP_PORT=9223 node scripts/check-release.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const TILES = Number(process.env.DJI_TILES || 369)
const FAV = Number(process.env.DJI_FAV || 2)
const port = Number(process.env.CDP_PORT || 9223)
// 版本从 package.json 读，避免每次发版都要改脚本
const EXPECTED_VERSION = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
).version
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ?? targets.find((t) => t.type === 'page')
if (!page) throw new Error(`CDP ${port} 上没有可用页面`)

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let seq = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text ?? 'exception')
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args?.map((a) => a.value ?? a.description).join(' ') ?? 'console.error')
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errors.push(m.params.entry.text ?? 'log.error')
  }
})
const send = (method, params = {}) => {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((r) => pending.set(id, r))
}
const ev = async (expr) => {
  const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return m.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
// 后台启动的打包版窗口可能 hidden，图片请求会被 Chromium 节流
await send('Page.bringToFront')
await send('Page.reload', { ignoreCache: true })
await send('Page.bringToFront')
await wait(3500)

const title = await ev('document.title')
check('页面已加载', !!title && title.includes('DJI'), title)

const tiles = await ev(`document.querySelectorAll('.tile').length`)
check('时光轴 TILES 张卡片', tiles === TILES, String(tiles))

const info = JSON.parse(await ev(`window.api.getAppInfo().then(x => JSON.stringify(x))`) || '{}')
check('数据库沿用（TILES 媒体 / 100 视频 / 218 照片）', info.files === TILES && info.videos + info.photos === info.files, JSON.stringify({ files: info.files, videos: info.videos, photos: info.photos }))
check('缩略图缓存沿用且无待生成', info.cacheFiles === TILES && info.thumbMissing === 0, JSON.stringify({ cacheFiles: info.cacheFiles, thumbMissing: info.thumbMissing }))
check('数据目录与开发态一致', /dji-album/i.test(info.userData ?? ''), String(info.userData))
check('打包版本号', info.version === EXPECTED_VERSION, `${info.version} (期望 ${EXPECTED_VERSION})`)

const state = JSON.parse(await ev(`(async () => JSON.stringify({
  fav: (await window.api.listFiles('all','time','favorites')).length,
  trash: (await window.api.listTrash()).length,
  nav: document.querySelectorAll('.sidebar .nav-item').length,
  broken: document.querySelectorAll('.tile img.broken').length
}))()`) || '{}')
check('收藏 / 回收站为空', state.fav === FAV && state.trash === 0, JSON.stringify({ fav: state.fav, trash: state.trash }))
check('侧栏 4 项导航（含设置）', state.nav === 4, String(state.nav))
check('无缩略图破损', state.broken === 0, String(state.broken))
check('无 JS 异常 / console error', errors.length === 0, errors.slice(0, 3).join(' | ') || '0')

ws.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? `, ${failed.length} FAILED` : ' — ALL PASS'}`)
if (failed.length) process.exit(1)
