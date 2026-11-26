const t = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const p = t.find((x) => x.type === 'page' && x.url.includes('index.html')) ?? t.find((x) => x.type === 'page')
const ws = new WebSocket(p.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
const expr = `(async () => JSON.stringify({
  innerWidth, innerHeight,
  contentW: document.querySelector('.content').getBoundingClientRect().width,
  clientW: document.querySelector('.content').clientWidth,
  sidebarW: document.querySelector('.sidebar').getBoundingClientRect().width,
  cols: document.querySelector('.masonry-row')?.dataset.cols,
  full: await window.api.isFullscreen(),
  theme: document.documentElement.dataset.theme
}))()`
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }))
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id === 1) { console.log(m.result?.result?.value ?? JSON.stringify(m)); ws.close() }
})
