// 右键菜单回归验证：使用 CDP 真实鼠标输入（而非合成 dispatchEvent）
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let page = null
for (let i = 0; i < 50; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9222}/json/list`)).json()
    page =
      targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ??
      targets.find((t) => t.type === 'page')
    if (page) break
  } catch {
    /* 尚未启动 */
  }
  await wait(300)
}
if (!page) {
  console.log('NO_PAGE: 9222 上没有可用页面')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let seq = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
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

async function waitForTiles() {
  for (let i = 0; i < 60; i++) {
    const n = await evalJs(`document.querySelectorAll('.tile').length`)
    if (n > 0) return n
    await wait(300)
  }
  return 0
}

const tileCenter = (i) =>
  evalJs(`(() => {
    const t = document.querySelectorAll('.tile')[${i}]
    if (!t) return null
    // 卡片可能滚出视口，CDP 真实鼠标用视口坐标，必须先滚进来
    t.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = t.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)

async function realRightClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 })
}

async function realLeftClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
}

const menuInfo = () =>
  evalJs(`(() => {
    const m = document.querySelector('.ctx-menu')
    if (!m) return null
    const r = m.getBoundingClientRect()
    return {
      x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      items: [...m.querySelectorAll('.ctx-item')].map((e) => e.textContent.trim())
    }
  })()`)

const results = []
const check = (label, pass, detail = '') => {
  results.push({ label, pass: !!pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`)
}

const tileCount = await waitForTiles()
check('时光轴已加载卡片', tileCount > 0, `tiles=${tileCount}`)
if (!tileCount) process.exit(1)

// 1) 真实右键：菜单应出现并保持可见（不是闪一下就消失）
const c1 = await tileCenter(0)
await realRightClick(c1.x, c1.y)
await wait(60)
const m1Immediate = await menuInfo()
await wait(600)
const m1Stable = await menuInfo()
check('第一次真实右键 → 菜单出现', !!m1Immediate, JSON.stringify(m1Immediate))
check('第一次真实右键 → 菜单稳定可见 600ms', !!m1Stable, JSON.stringify(m1Stable))
check('菜单含 4 个操作项', (m1Stable?.items?.length ?? 0) === 4, JSON.stringify(m1Stable?.items))

// 2) 菜单打开期间对另一张卡片再次右键，应重新出现且稳定
const c2 = await tileCenter(1)
await realRightClick(c2.x, c2.y)
await wait(60)
const m2Immediate = await menuInfo()
await wait(600)
const m2Stable = await menuInfo()
check('菜单已开时第二次真实右键 → 菜单出现', !!m2Immediate, JSON.stringify(m2Immediate))
check('第二次真实右键 → 菜单稳定可见 600ms', !!m2Stable, JSON.stringify(m2Stable))

// 3) 点击菜单项（查看元数据，只读）应真正执行
if (m2Stable) {
  await realLeftClick(m2Stable.x + 60, m2Stable.y + 40)
  await wait(300)
  const modal = await evalJs(`!!document.querySelector('.modal-backdrop')`)
  const menuGone = await evalJs(`!document.querySelector('.ctx-menu')`)
  check('点击菜单项 → 触发动作并关闭菜单', modal && menuGone, `modal=${modal} menuGone=${menuGone}`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  // 弹窗遮罩若没关掉会挡住下一步的右键，显式兜底
  await evalJs(`(() => { document.querySelector('.modal-close')?.click(); return true })()`)
  await wait(250)
}

// 4) 点击外部区域应关闭菜单
const c3 = await tileCenter(2)
await realRightClick(c3.x, c3.y)
await wait(200)
const beforeOutside = await menuInfo()
// 左下角空白区，避开卡片（卡片 onClick 会打开播放器，污染后续脚本）
const outside = await evalJs(`({ x: 10, y: window.innerHeight - 10 })`)
await realLeftClick(outside.x, outside.y)
await wait(250)
const afterOutside = await menuInfo()
check('点击外部 → 菜单关闭', !!beforeOutside && !afterOutside, `before=${!!beforeOutside} after=${!!afterOutside}`)
check('外部点击未误开播放器', await evalJs(`!document.querySelector('.player-backdrop')`), '')

// 5) 完整合成序列（mousedown(button=2) → contextmenu）作为补充回归
const synthetic = await evalJs(`(() => {
  const t = document.querySelectorAll('.tile')[3]
  if (!t) return 'no-tile'
  const r = t.getBoundingClientRect()
  const x = Math.round(r.left + 30), y = Math.round(r.top + 30)
  t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2, buttons: 2, clientX: x, clientY: y }))
  t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2, buttons: 2, clientX: x, clientY: y }))
  return 'dispatched'
})()`)
await wait(300)
const m5 = await menuInfo()
check('合成完整右键序列 → 菜单可见', !!m5, `${synthetic} ${JSON.stringify(m5)}`)

// 6) Escape 关闭，并让页面回到干净状态（避免污染后续脚本）
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await wait(200)
check('Escape → 菜单关闭', !(await menuInfo()), '')

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
ws.close()
process.exit(failed.length ? 1 : 0)
