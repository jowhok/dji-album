const list = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html')) ?? list.find((t) => t.type === 'page')
if (!page) {
  console.log('no page target', JSON.stringify(list.map((t) => ({ type: t.type, url: t.url }))))
  process.exit(1)
}

const expr = `JSON.stringify({
  title: document.title,
  tiles: document.querySelectorAll('.tile').length,
  images: document.images.length,
  loaded: [...document.images].filter(i => i.complete && i.naturalWidth > 0).length,
  broken: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
  groups: [...document.querySelectorAll('.date-group-head')].slice(0, 3).map(e => e.textContent.trim()),
  sample: [...document.images].slice(0, 2).map(i => i.src.slice(0, 100))
})`

const ws = new WebSocket(page.webSocketDebuggerUrl)
const timer = setTimeout(() => { console.log('CDP timeout'); process.exit(1) }, 10000)
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }))
})
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id === 1) {
    clearTimeout(timer)
    console.log(msg.result?.result?.value ?? JSON.stringify(msg))
    ws.close()
    process.exit(0)
  }
})
