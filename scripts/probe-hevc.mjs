const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json/list`)).json()
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
const m = await send('Runtime.evaluate', {
  expression: `(async () => {
    const v = document.createElement('video')
    const types = [
      'video/mp4; codecs="hvc1.1.6.L93.B0"',
      'video/mp4; codecs="hev1.1.6.L93.B0"',
      'video/mp4; codecs="hvc1"',
      'video/mp4; codecs="avc1.42E01E"',
      'video/mp4'
    ]
    const canPlay = types.map(t => t + ' => ' + (v.canPlayType(t) || '(empty)'))
    let mcap
    try {
      const r = await navigator.mediaCapabilities.decodingInfo({
        type: 'file',
        video: { contentType: 'video/mp4; codecs="hvc1.1.6.L93.B0"', width: 1280, height: 720, bitrate: 5000000, framerate: 30 }
      })
      mcap = { supported: r.supported, smooth: r.smooth, powerEfficient: r.powerEfficient }
    } catch (e) { mcap = { error: String(e) } }
    return JSON.stringify({ canPlay, mcap, chrome: navigator.userAgent.match(/Chrome\\/[\\d.]+/)?.[0] })
  })()`,
  returnByValue: true,
  awaitPromise: true
})
console.log(m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails ?? m))
ws.close()
