import { writeFileSync } from 'fs'
const TILES = Number(process.env.DJI_TILES || 369)
const FAV = Number(process.env.DJI_FAV || 2)

const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json/list`)).json()
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
const clickBtn = (kw, scope = '.toolbar-actions .btn') =>
  evalJs(`(() => {
    const b = [...document.querySelectorAll('${scope}')].find(x => x.textContent.includes('${kw}'))
    b?.click(); return !!b
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

// 1. 软删 1 个媒体（安全，不动 NAS 文件）
await rightClickFirst()
await wait(200)
await clickMenuItem('回收站')
await wait(600)
await nav('回收站')
await wait(600)
const tb = JSON.parse(await evalJs(`window.api.listTrash().then(x => JSON.stringify(x))`))
check(tb.length === 1, '软删后回收站 1 项', JSON.stringify(tb.map((x) => x.name)))
writeFileSync('.tmp/purge-check-path.txt', tb[0]?.path ?? '', 'utf-8')

// 2. 勾选 → 打开彻底删除确认弹窗
await evalJs(`(() => { document.querySelector('.trash-card')?.click(); return true })()`)
await wait(150)
await clickBtn('彻底删除')
await wait(900) // 等 purgePreview IPC 返回

check(await evalJs(`!!document.querySelector('.purge-modal')`), '确认弹窗出现')
const warn = await evalJs(`document.querySelector('.purge-warn strong')?.textContent ?? ''`)
check(warn.includes('此操作非常危险') && warn.includes('不可逆'), '粗体不可逆警告', warn)
const summary = await evalJs(`document.querySelector('.purge-summary')?.textContent ?? ''`)
check(/1 个媒体/.test(summary) && /\d+ 个文件/.test(summary), '统计条（媒体数/文件数/体积）', summary)

const list = JSON.parse(await evalJs(`JSON.stringify({
  items: document.querySelectorAll('.purge-item').length,
  files: document.querySelectorAll('.purge-file').length,
  paths: [...document.querySelectorAll('.purge-file-path')].map(e => e.textContent),
  sizes: [...document.querySelectorAll('.purge-file-size')].map(e => e.textContent)
})`))
check(list.items === 1, '清单列出 1 个媒体', JSON.stringify(list))
check(list.files >= 1 && list.files <= 2, '清单列出实际待删文件（视频 2 / 照片 1）', String(list.files))
check(list.paths.every((p) => p.includes('192.168.5.32')), '清单含 NAS 完整 UNC 路径', list.paths.join(' | '))
check(
  list.paths.every((p) => /\.(mp4|lrf|jpe?g)$/i.test(p)),
  '清单只含白名单扩展名', list.paths.join(' | ')
)
check(list.sizes.some((s) => /\d/.test(s)), '清单显示文件大小', list.sizes.join(' | '))

const btnState = async () =>
  JSON.parse(await evalJs(`(() => {
    const b = [...document.querySelectorAll('.modal-foot .btn')].find(x => x.textContent.includes('永久删除'))
    return b ? JSON.stringify({ disabled: b.disabled, text: b.textContent.trim() }) : 'null'
  })()`) ?? 'null')
const before = await btnState()
check(before?.disabled === true, '未勾选时「永久删除」禁用', JSON.stringify(before))
await evalJs(`(() => { document.querySelector('.purge-check input')?.click(); return true })()`)
await wait(200)
const after = await btnState()
check(after?.disabled === false, '勾选后放行', JSON.stringify(after))

// 3. 只读 IPC：主进程白名单必须拒绝任意本地路径
const pb = JSON.parse(await evalJs(
  `window.api.purgePreview(['C:\\\\Windows\\\\evil.mp4']).then(x => JSON.stringify(x))`
))
check(
  pb.ok === true && pb.data.items.length === 0 && pb.data.rejected.length === 1,
  '主进程白名单拒绝 root 外路径', JSON.stringify(pb)
)

// 4. 尝试把 purge 替换成假函数，安全验证「执行结果视图」；contextBridge 冻结则跳过
const patched = await evalJs(`(() => {
  const fake = async (paths) => ({ ok: true, data: {
    total: paths.length, succeeded: paths.length, failed: 0, bytes: 1,
    items: paths.map(p => ({ path: p, ok: true, deleted: [p], failed: [] }))
  } })
  try { window.api.purge = fake } catch (e) {}
  return window.api.purge === fake
})()`)
r.patchable = { pass: true, detail: String(patched) }
if (patched) {
  await clickBtn('永久删除', '.modal-foot .btn')
  await wait(700)
  check(await evalJs(`!!document.querySelector('.purge-result')`), '删除结果视图渲染（假删除，未动文件）')
} else {
  check(true, 'contextBridge 冻结，执行态 UI 由单测覆盖（不真删）')
}

// 5. 关闭弹窗 → 确认 NAS 文件与 trash 记录都还在（从未真删）
await clickBtn('取消', '.modal-foot .btn')
await clickBtn('关闭', '.modal-foot .btn')
await wait(500)
const st = JSON.parse(await evalJs(`window.api.listTrash().then(x => JSON.stringify(x))`))
check(st.length === 1, '取消后 trash 记录保留（未执行删除）', String(st.length))
check(await evalJs(`!document.querySelector('.purge-modal')`), '弹窗已关闭')

// 6. 恢复，还原现场
await evalJs(`(() => { document.querySelector('.trash-card')?.click(); return true })()`)
await wait(150)
await clickBtn('恢复选中')
await wait(700)
check(await evalJs(`document.querySelectorAll('.trash-card').length`) === 0, '恢复后回收站清空')
await nav('时光轴')
await wait(500)
check(await evalJs(`document.querySelectorAll('.tile').length`) === TILES, '时光轴回到 TILES')

ws.close()
const failed = Object.entries(r).filter(([, v]) => v && typeof v === 'object' && v.pass === false)
console.log(JSON.stringify(r, null, 2))
console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'}`)
if (failed.length > 0) process.exit(1)
