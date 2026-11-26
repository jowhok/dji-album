const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json/list`)).json()
const page =
  targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ??
  targets.find((t) => t.type === 'page')
if (!page) {
  console.log('no page target', JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url }))))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res) => ws.addEventListener('open', res))
let seq = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
function send(method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res) => pending.set(id, res))
}
async function evalJs(expr) {
  const m = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true
  })
  if (m.result?.exceptionDetails) {
    throw new Error(JSON.stringify(m.result.exceptionDetails))
  }
  return m.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const report = {}
const assert = (cond, label, extra = '') => {
  report[label] = { pass: !!cond, ...(extra ? { detail: extra } : {}) }
}

// 1. 布局：按日期分组逐组校验 DOM 顺序 == 行优先分配结果
report.layout = await evalJs(`(async () => {
  const rows = await window.api.listFiles('all', 'time')
  const sections = [...document.querySelectorAll('.content section')]
  let checked = 0, bad = 0, colsSeen = new Set()
  for (const sec of sections) {
    const head = sec.querySelector('.date-group-head')
    if (!head) continue
    const date = head.textContent.trim().slice(0, 10).replace(/-/g, '')
    const rowEl = sec.querySelector('.masonry-row')
    if (!rowEl) continue
    const cols = Number(rowEl.dataset.cols)
    colsSeen.add(cols)
    const domNames = [...sec.querySelectorAll('.tile')].map(t => t.title.split('\\n')[0])
    const expect = rows.filter(r => r.dir_date === date).map(r => r.name)
    const byCol = []
    for (let c = 0; c < cols; c++) for (let i = c; i < expect.length; i += cols) byCol.push(expect[i])
    if (JSON.stringify(domNames) === JSON.stringify(byCol)) checked++
    else bad++
  }
  return JSON.stringify({
    sections: sections.length, checked, bad,
    cols: [...colsSeen],
    tiles: document.querySelectorAll('.tile').length,
    columnContainers: document.querySelectorAll('.masonry-col').length,
    firstGroupFirstFour: (() => {
      const sec = document.querySelector('.content section')
      return [...sec.querySelectorAll('.masonry-col')].map(c => c.querySelector('.tile')?.title.split('\\n')[0])
    })()
  })
})()`)
const layout = JSON.parse(report.layout)
assert(layout.bad === 0 && layout.checked > 0, '行优先瀑布流顺序', `${layout.checked} 组全对，${layout.bad} 组不符`)
assert(layout.cols.includes(4), '列数 = 4', JSON.stringify(layout.cols))
assert(layout.tiles > 300, '卡片总数', String(layout.tiles))

// 2. 视频时长角标
report.durations = await evalJs(`JSON.stringify({
  count: document.querySelectorAll('.tile-duration').length,
  samples: [...document.querySelectorAll('.tile-duration')].slice(0, 5).map(e => e.textContent),
  badFormat: [...document.querySelectorAll('.tile-duration')].filter(e => !/^\\d{1,2}:\\d{2}(:\\d{2})?$/.test(e.textContent)).length,
  videoTiles: document.querySelectorAll('.tile .tile-play').length
})`)
const dur = JSON.parse(report.durations)
assert(dur.count > 50, '时长角标数量', String(dur.count))
assert(dur.badFormat === 0, '时长格式全部合法', `bad=${dur.badFormat}`)
assert(dur.count === dur.videoTiles, '每个视频都有时长', `${dur.count}/${dur.videoTiles}`)

// 3. 右键菜单：在第一个卡片上派发 contextmenu
// 元数据断言检查视频字段（时长/帧率等），必须在视频卡片上右键
await evalJs(`(() => {
  const t = [...document.querySelectorAll('.tile')].find(x => x.querySelector('.tile-play')) ?? document.querySelector('.tile')
  const r = t.getBoundingClientRect()
  t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 30, clientY: r.top + 30 }))
  return true
})()`)
await wait(250)
report.menu = await evalJs(`JSON.stringify({
  visible: !!document.querySelector('.ctx-menu'),
  items: [...document.querySelectorAll('.ctx-menu .ctx-item')].map(e => e.textContent.trim()),
  foot: document.querySelector('.ctx-foot')?.textContent.trim()
})`)
const menu = JSON.parse(report.menu)
assert(menu.visible, '右键菜单弹出', '')
assert(
  menu.items.some((x) => x.includes('查看元数据')) &&
    menu.items.some((x) => x.includes('加入收藏') || x.includes('取消收藏')) &&
    menu.items.some((x) => x.includes('下载')) &&
    menu.items.some((x) => x.includes('回收站')),
  '菜单四项齐全',
  JSON.stringify(menu.items)
)

// 4. 点击「查看元数据」-> 弹窗内容
await evalJs(`(() => { document.querySelectorAll('.ctx-menu .ctx-item')[0].click(); return true })()`)
await wait(900)
report.modal = await evalJs(`JSON.stringify({
  visible: !!document.querySelector('.modal'),
  rows: document.querySelectorAll('.modal .meta-row').length,
  fields: [...document.querySelectorAll('.modal .meta-row')].map(e => e.querySelector('.meta-key').textContent),
  duration: [...document.querySelectorAll('.modal .meta-row')].find(e => e.querySelector('.meta-key').textContent === '时长')?.querySelector('.meta-val').textContent,
  warn: document.querySelector('.meta-warn')?.textContent.trim() ?? null
})`)
const modal = JSON.parse(report.modal)
assert(modal.visible && modal.rows >= 10, '元数据弹窗字段', `${modal.rows} 项`)
assert(
  ['时长', '分辨率', '文件大小', '完整路径'].every((k) => modal.fields.includes(k)),
  '关键字段存在',
  JSON.stringify(modal.fields)
)
assert(/^\d{1,2}:\d{2}/.test(modal.duration ?? ''), '弹窗显示时长', String(modal.duration))

await evalJs(`(() => { document.querySelector('.modal-close')?.click(); return true })()`)
await wait(200)
assert(!(await evalJs(`!!document.querySelector('.modal')`)), '弹窗可关闭')

// 5. IPC 闭环：收藏 / 软删 / 恢复（自动还原，不污染用户数据）
report.ipc = await evalJs(`(async () => {
  const rows = await window.api.listFiles('all', 'time')
  const p = rows[0].path
  const f1 = await window.api.toggleFav(p)
  const favList = await window.api.listFiles('all', 'time', 'favorites')
  const f2 = await window.api.toggleFav(p)
  const t1 = await window.api.moveToTrash([p])
  const trash = await window.api.listTrash()
  const hidden = (await window.api.listFiles('all', 'time')).some(r => r.path === p)
  const r1 = await window.api.restore([p])
  const trashAfter = await window.api.listTrash()
  const visibleAgain = (await window.api.listFiles('all', 'time')).some(r => r.path === p)
  return JSON.stringify({
    favOn: f1.ok && f1.data === true,
    favInList: favList.some(r => r.path === p),
    favOff: f2.ok && f2.data === false,
    trashOk: t1.ok,
    inTrash: trash.some(r => r.path === p),
    hiddenFromTimeline: !hidden,
    restoreOk: r1.ok,
    trashClean: !trashAfter.some(r => r.path === p),
    visibleAgain
  })
})()`)
const ipc = JSON.parse(report.ipc)
assert(ipc.favOn && ipc.favInList && ipc.favOff, '收藏 IPC 闭环')
assert(ipc.trashOk && ipc.inTrash && ipc.hiddenFromTimeline, '软删进回收站')
assert(ipc.restoreOk && ipc.trashClean && ipc.visibleAgain, '恢复后重回时光轴')

ws.close()
const failed = Object.entries(report).filter(([, v]) => v && typeof v === 'object' && v.pass === false)
console.log(JSON.stringify(report, null, 2))
console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'}`)
if (failed.length > 0) process.exit(1)
