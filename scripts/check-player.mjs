const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json/list`)).json()
const TILES = Number(process.env.DJI_TILES || 369)
const FAV = Number(process.env.DJI_FAV || 2)
const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ?? targets.find((t) => t.type === 'page')
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
async function waitFor(expr, timeoutMs = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const v = await evalJs(expr)
    if (v) return v
    await wait(350)
  }
  return null
}
const report = {}
const check = (cond, label, detail = '') => { report[label] = { pass: !!cond, detail } }

const V = `(() => {
  const v = document.querySelector('.player-stage video')
  if (!v) return null
  return { src: v.src, ready: v.readyState, w: v.videoWidth, h: v.videoHeight,
           err: v.error ? v.error.code : null, paused: v.paused, t: v.currentTime,
           dur: v.duration, seeking: v.seeking }
})()`

// 1. 点击卡片打开播放器
await waitFor(`document.querySelectorAll('.tile').length === ${TILES}`, 20000)
// 必须选视频卡片：新数据排序后第一个卡片是照片，没有 <video> / 进度条
await evalJs(`(() => { const t = [...document.querySelectorAll('.tile')].find(x => x.querySelector('.tile-play')); t?.click(); return !!t })()`)
await wait(400)
check(await evalJs(`!!document.querySelector('.player-backdrop')`), '点击卡片打开播放器')

// 2. 真实 HEVC 解码：等到有元数据 + 有画面尺寸
const loaded = await waitFor(`(() => { const v = document.querySelector('.player-stage video'); return v && v.readyState >= 2 && v.videoWidth > 0 ? JSON.stringify({w:v.videoWidth,h:v.videoHeight,dur:v.duration,src:v.src}) : null })()`)
const meta = loaded ? JSON.parse(loaded) : null
check(!!meta, '视频元数据加载（HEVC 可解码）', loaded ?? 'timeout')
check(meta && meta.w > 0 && meta.h > 0, '解码出真实画面尺寸', meta ? `${meta.w}x${meta.h}` : '')
check(meta && meta.src.includes('/media/'), '视频源走本地 Range 代理', meta?.src?.slice(0, 60) ?? '')
check(await evalJs(`!document.querySelector('.player-error')`), '无解码/加载错误')

// 3. 真的在播放（currentTime 前进）
const t0 = await evalJs(`document.querySelector('.player-stage video')?.currentTime ?? -1`)
await wait(1800)
const t1 = await evalJs(`document.querySelector('.player-stage video')?.currentTime ?? -1`)
check(t1 > t0 + 0.3, '视频真实播放（时间轴前进）', `${t0.toFixed(2)} -> ${t1.toFixed(2)}`)

// 4. 拖动进度（依赖 Range 206）
const seekTarget = meta ? Math.min(20, Math.max(2, meta.dur * 0.4)) : 10
await evalJs(`(() => {
  const el = document.querySelector('.player-seek input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(el, '${seekTarget}')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`)
const seeked = await waitFor(`(() => {
  const v = document.querySelector('.player-stage video')
  return v && Math.abs(v.currentTime - ${seekTarget}) < 1.5 && !v.seeking && v.readyState >= 2
    ? String(v.currentTime) : null
})()`, 15000)
check(!!seeked, '拖动进度生效（Range 206 分片）', seeked ? `currentTime=${Number(seeked).toFixed(2)}` : 'timeout')

// 5. 切换清晰度 LRF -> MP4，且保留进度
const srcBefore = await evalJs(`document.querySelector('.player-stage video')?.src`)
const tBefore = await evalJs(`document.querySelector('.player-stage video')?.currentTime`)
check(await evalJs(`!!document.querySelector('.pbtn.quality')`), '有清晰度切换按钮')
await evalJs(`(() => { document.querySelector('.pbtn.quality')?.click(); return true })()`)
const switched = await waitFor(`(() => {
  const v = document.querySelector('.player-stage video')
  return v && v.src !== '${srcBefore}' && v.readyState >= 2 ? v.src : null
})()`, 20000)
check(!!switched, '切换到 MP4 高清源', switched ? switched.slice(-24) : 'timeout')
const tAfter = await evalJs(`document.querySelector('.player-stage video')?.currentTime ?? -1`)
check(Math.abs(tAfter - tBefore) < 3, '切换后保留播放进度', `${tBefore.toFixed(1)} -> ${tAfter.toFixed(1)}`)

// 6. 下一个（key 重挂载，旧 video 释放）
const nameBefore = await evalJs(`document.querySelector('.player-title strong')?.textContent`)
await evalJs(`(() => { document.querySelector('.player-arrow.next')?.click(); return true })()`)
await wait(900)
const nameAfter = await evalJs(`document.querySelector('.player-title strong')?.textContent`)
check(nameAfter && nameAfter !== nameBefore, '下一个切换媒体', `${nameBefore} -> ${nameAfter}`)
// 切到照片时 video 为 0、切到视频时为 1，只要不出现重复的残留元素即可
check(await evalJs(`document.querySelectorAll('video').length <= 1`), '切换后无残留 video 元素')

// 7. 播放器内收藏（左下角控制条，点两次还原）
await evalJs(`(() => { document.querySelector('.player-buttons .pbtn.fav')?.click(); return true })()`)
await wait(500)
check(await evalJs(`!!document.querySelector('.pbtn.fav.on')`), '播放器内收藏生效')
await evalJs(`(() => { document.querySelector('.player-buttons .pbtn.fav')?.click(); return true })()`)
await wait(400)

// 8. 关闭即停
await evalJs(`(() => { document.querySelector('.pbtn.close')?.click(); return true })()`)
await wait(500)
check(!(await evalJs(`!!document.querySelector('.player-backdrop')`)), '关闭弹窗')
check(await evalJs(`document.querySelectorAll('video').length === 0`), '关闭后 video 元素已移除（停止解码）')

// 9. 照片预览复用同一弹窗
await evalJs(`(() => {
  const tabs = [...document.querySelectorAll('.toolbar-left .seg span')]
  tabs.find(t => t.textContent.trim() === '照片')?.click()
  return true
})()`)
await wait(800)
await evalJs(`(() => { document.querySelector('.tile')?.click(); return true })()`)
const photoOk = await waitFor(`(() => {
  const im = document.querySelector('.player-photo')
  return im && im.complete && im.naturalWidth > 0 ? im.naturalWidth + 'x' + im.naturalHeight : null
})()`, 15000)
check(!!photoOk, '照片在同一弹窗预览', photoOk ?? 'timeout')
await evalJs(`(() => { document.querySelector('.pbtn.close')?.click(); return true })()`)
await wait(400)

// 10. 播放器内软删 -> 自动跳下一个 -> 回收站还原
await evalJs(`(() => {
  const tabs = [...document.querySelectorAll('.toolbar-left .seg span')]
  tabs.find(t => t.textContent.trim() === '全部')?.click()
  return true
})()`)
await wait(700)
await evalJs(`(() => { document.querySelector('.tile')?.click(); return true })()`)
await wait(500)
const delName = await evalJs(`document.querySelector('.player-title strong')?.textContent`)
await evalJs(`(() => { [...document.querySelectorAll('.player-head-actions .pbtn')].find(b => b.textContent.includes('回收站'))?.click(); return true })()`)
await wait(900)
const nextName = await evalJs(`document.querySelector('.player-title strong')?.textContent ?? null`)
check(nextName && nextName !== delName, '软删后自动跳到下一个', `${delName} -> ${nextName}`)
const trashCount = await evalJs(`(async () => (await window.api.listTrash()).length)()`)
check(trashCount === 1, '软删已进回收站', String(trashCount))
await evalJs(`(async () => { const t = await window.api.listTrash(); await window.api.restore(t.map(r => r.path)); return true })()`)
await evalJs(`(() => { document.querySelector('.pbtn.close')?.click(); return true })()`)
await wait(300)
await evalJs(`(() => { location.reload(); return true })()`)
await wait(2500)
const finalTiles = await waitFor(`document.querySelectorAll('.tile').length === ${TILES} ? '${TILES}' : null`, 12000)
check(!!finalTiles, '还原后时光轴恢复 TILES 卡片', finalTiles ?? 'timeout')

ws.close()
const failed = Object.entries(report).filter(([, v]) => v && v.pass === false)
console.log(JSON.stringify(report, null, 2))
console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'}`)
if (failed.length > 0) process.exit(1)
