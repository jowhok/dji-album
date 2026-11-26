// 诊断探针：记录真实右键时的事件序列与 .ctx-menu 的挂载/卸载
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json/list`)).json()
const page =
  targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ??
  targets.find((t) => t.type === 'page')
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

await evalJs(`(() => {
  window.__log = []
  window.__t0 = performance.now()
  const stamp = () => Math.round(performance.now() - window.__t0)
  for (const type of ['mousedown', 'mouseup', 'contextmenu', 'click', 'auxclick']) {
    window.addEventListener(type, (e) => {
      window.__log.push({ t: stamp(), phase: 'capture', type, button: e.button, buttons: e.buttons,
        trusted: e.isTrusted, prevented: e.defaultPrevented,
        target: (e.target && e.target.className || '').toString().slice(0, 40) })
    }, true)
    window.addEventListener(type, (e) => {
      window.__log.push({ t: stamp(), phase: 'bubble-window', type, button: e.button, trusted: e.isTrusted,
        prevented: e.defaultPrevented })
    })
  }
  new MutationObserver(() => {
    const has = !!document.querySelector('.ctx-menu')
    window.__log.push({ t: stamp(), phase: 'mutation', menu: has })
  }).observe(document.body, { childList: true, subtree: true })
  return 'installed'
})()`)

const center = await evalJs(`(() => {
  const t = document.querySelectorAll('.tile')[5]
  const r = t.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
console.log('tile center:', center)

const p = { x: center.x, y: center.y }
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p, button: 'none', buttons: 0 })
await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'right', buttons: 2, clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'right', buttons: 0, clickCount: 1 })
await wait(500)

const log = await evalJs(`JSON.stringify(window.__log)`)
console.log(log)
console.log('menu now:', await evalJs(`!!document.querySelector('.ctx-menu')`))
ws.close()
