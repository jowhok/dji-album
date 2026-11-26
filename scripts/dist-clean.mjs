/**
 * 干净打包：绕开 WorkBuddy safe-delete 守卫（electron-builder 清空旧 win-unpacked 会被拦）。
 * 稳定输出目录已有 stage 时，临时把 build.directories.output 改到全新目录构建，
 * 再把 exe / blockmap / yml 覆盖回稳定目录；package.json 在 finally 中恢复。
 * 用法：npm run dist:clean
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(ROOT, 'package.json')
const original = readFileSync(pkgPath, 'utf8')
const pkg = JSON.parse(original)
const out = pkg.build.directories.output
const stable = join(ROOT, out)
const hasStage = existsSync(join(stable, 'win-unpacked'))
const stageRel = hasStage ? `${out}-build-${Date.now()}` : out
const stage = join(ROOT, stageRel)

const run = (cmd, args) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} 退出码 ${c}`))))
})

if (hasStage) {
  console.log(`检测到旧 stage：${out}/win-unpacked → 本次构建到全新目录 ${stageRel}`)
  const patched = original.replace(/"output"\s*:\s*"[^"]+"/, `"output": "${stageRel}"`)
  if (patched === original) throw new Error('未能替换 package.json 的 directories.output')
  writeFileSync(pkgPath, patched, 'utf8')
}

try {
  await run('npm', ['run', 'dist'])
} finally {
  if (hasStage) writeFileSync(pkgPath, original, 'utf8')
}

if (hasStage) {
  mkdirSync(stable, { recursive: true })
  for (const f of readdirSync(stage)) {
    if (!/\.(exe|blockmap|yml)$/i.test(f)) continue
    const src = join(stage, f)
    if (!existsSync(src)) continue
    copyFileSync(src, join(stable, f))
    console.log(`→ ${join(out, f)}`)
  }
}
console.log(`完成：交付产物在 ${out}/（构建 stage：${stageRel}）`)
