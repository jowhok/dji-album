/**
 * 全套回归统一入口：自动探测基线（媒体数 / 收藏数），依次刷干净页并跑各脚本后汇总。
 * 用法：CDP_PORT=9222 node scripts/check-all.mjs
 * 前置：应用已带 --remote-debugging-port 启动（端口与 CDP_PORT 一致）
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.env.CDP_PORT || '9222'

const SCRIPTS = [
  'check-thumbs.mjs', 'check-date-filter.mjs', 'check-photo-zoom.mjs', 'check-settings.mjs',
  'check-player-ui.mjs', 'check-player-popup.mjs', 'check-player.mjs',
  'check-m6.mjs', 'check-features.mjs', 'check-views.mjs', 'check-purge.mjs',
  'check-contextmenu.mjs', 'check-release.mjs'
]

// 只跑匹配的脚本（如 DJI_ONLY=thumbs），用于验证单个回归而不必跑全套
const ONLY = process.env.DJI_ONLY
const TARGETS = ONLY ? SCRIPTS.filter((s) => s.includes(ONLY)) : SCRIPTS
if (TARGETS.length === 0) throw new Error(`DJI_ONLY=${ONLY} 没有匹配任何脚本`)

async function baseline() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('index.html')) ?? list.find((t) => t.type === 'page')
  if (!page) throw new Error(`CDP ${PORT} 上没有可用页面，请先带 --remote-debugging-port 启动应用`)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  const value = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('读取 app:info 超时')), 8000)
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id !== 1) return
      clearTimeout(timer)
      resolve(m.result?.result?.value)
    })
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: 'window.api.getAppInfo().then(i => ({ files: i.files, favorites: i.favorites, trash: i.trash }))',
        returnByValue: true,
        awaitPromise: true
      }
    }))
  })
  ws.close()
  if (!value || typeof value.files !== 'number') throw new Error('无法读取 app:info，基线探测失败')
  return value
}

const run = (file, env) => new Promise((resolve) => {
  const p = spawn(process.execPath, [join(ROOT, 'scripts', file)], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = ''
  p.stdout.on('data', (d) => { out += d })
  p.stderr.on('data', (d) => { out += d })
  p.on('close', (code) => resolve({ code, out }))
})

const b = await baseline()
const env = { DJI_TILES: String(b.files), DJI_FAV: String(b.favorites), CDP_PORT: PORT }
console.log(`基线自动探测：files=${b.files} fav=${b.favorites} trash=${b.trash} port=${PORT}\n`)

let failed = 0
for (const s of TARGETS) {
  const reload = await run('reload-cdp.mjs', env)
  if (reload.code !== 0) {
    failed++
    console.log(`FAIL  ${s}（干净页刷新失败）\n${reload.out.split('\n').slice(-12).join('\n')}`)
    continue
  }
  const r = await run(s, env)
  const ok = r.code === 0
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`)
  if (!ok) console.log(r.out.split('\n').slice(-25).join('\n'))
}

console.log(`\n${TARGETS.length - failed}/${TARGETS.length} 脚本通过`)
process.exit(failed ? 1 : 0)
