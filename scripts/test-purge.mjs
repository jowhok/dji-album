import { createRequire } from 'module'
import {
  mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, rmSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const require = createRequire(import.meta.url)
const { initDb, getDb, buildPurgePlan, executePurge, setThumbsDir } =
  require('../.tmp/test-purge.cjs')

let pass = 0
let failed = 0
const assert = (cond, label, detail = '') => {
  if (cond) { pass++; console.log('  ok   ' + label) }
  else { failed++; console.log('  FAIL ' + label + (detail ? '  -- ' + detail : '')) }
}

// 用系统临时目录模拟 NAS 根，真实建文件 / 真实 unlink；绝不触碰真实 NAS
const root = mkdtempSync(join(tmpdir(), 'dji-purge-'))
const thumbs = join(root, 'thumbs')
mkdirSync(thumbs)
mkdirSync(join(root, '20261120'))
mkdirSync(join(root, '20261121'))
initDb(join(root, 'test.db'))
setThumbsDir(thumbs)
const db = getDb()
const now = Date.now()

const ins = db.prepare(`
  INSERT INTO files (path, name, type, dir_date, size, taken_at, thumb, lrf_path, indexed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const addTrash = db.prepare('INSERT INTO trash(path, deleted_at) VALUES (?, ?)')
const addFav = db.prepare('INSERT INTO favorites(path, created_at) VALUES (?, ?)')
const inFiles = db.prepare('SELECT 1 FROM files WHERE path = ?')
const inTrash = db.prepare('SELECT 1 FROM trash WHERE path = ?')
const inFav = db.prepare('SELECT 1 FROM favorites WHERE path = ?')

function addRow(path, o = {}) {
  ins.run(
    path, o.name ?? path.split(/[\\/]/).pop(), o.type ?? 'video', '20261120',
    o.size ?? 0, now, o.thumb ?? null, o.lrf ?? null, now
  )
  if (o.trashed !== false) addTrash.run(path, now)
  if (o.fav !== false) addFav.run(path, now)
}

const d20 = join(root, '20261120')
const d21 = join(root, '20261121')

// A / C：正常视频（mp4 + lrf）；B：照片；D：库里有记录但物理文件已不存在
const aMp4 = join(d20, 'DJI_A.mp4')
const aLrf = join(d20, 'DJI_A.LRF')
const bJpg = join(d20, 'DJI_B.JPG')
const cMp4 = join(d21, 'DJI_C.mp4')
const cLrf = join(d21, 'DJI_C.LRF')
const dMp4 = join(d21, 'DJI_D.mp4')
writeFileSync(aMp4, Buffer.alloc(1024))
writeFileSync(aLrf, Buffer.alloc(256))
writeFileSync(bJpg, Buffer.alloc(512))
writeFileSync(cMp4, Buffer.alloc(2048))
writeFileSync(cLrf, Buffer.alloc(128))
const aThumb = 'a'.repeat(40) + '.jpg'
const cThumb = 'c'.repeat(40) + '.jpg'
writeFileSync(join(thumbs, aThumb), 'x')
writeFileSync(join(thumbs, cThumb), 'x')

addRow(aMp4, { size: 1024, lrf: aLrf, thumb: aThumb })
addRow(bJpg, { type: 'photo', size: 512 })
addRow(cMp4, { size: 2048, lrf: cLrf, thumb: cThumb })
addRow(dMp4, { size: 0 })

// E：lrf_path 故意指向一个目录，unlink 必然失败 —— 测部分失败与重试收敛
const eMp4 = join(d21, 'DJI_E.mp4')
const eLrfDir = join(d21, 'DJI_E.LRF')
writeFileSync(eMp4, Buffer.alloc(64))
mkdirSync(eLrfDir)
addRow(eMp4, { size: 64, lrf: eLrfDir })

// F：孤儿 LRF（path === lrf_path），应去重成一个待删文件
const fLrf = join(d21, 'DJI_F.LRF')
writeFileSync(fLrf, Buffer.alloc(32))
addRow(fLrf, { size: 32, lrf: fLrf })

// 安全白名单反例
const xNotTrashed = join(d21, 'DJI_X.mp4')          // 在 files、不在 trash
const yEscape = join(root, '..', 'evil.mp4')        // 目录穿越到 root 外
const zTxt = join(d21, 'DJI_Z.txt')                 // 扩展名不在白名单
const ghost = join(d21, 'ghost.mp4')                // 不在 files 表
writeFileSync(xNotTrashed, Buffer.alloc(10))
writeFileSync(zTxt, Buffer.alloc(10))
addRow(xNotTrashed, { trashed: false })
addRow(yEscape)
addRow(zTxt)

console.log('\n--- buildPurgePlan（只读预览） ---')
const plan = buildPurgePlan([aMp4, bJpg, cMp4], root)
assert(plan.length === 3, '3 个媒体进入计划', String(plan.length))
const byPath = Object.fromEntries(plan.map((i) => [i.path, i]))
assert(byPath[aMp4]?.files.length === 2, '视频列出 mp4 + lrf 两个文件')
assert(byPath[bJpg]?.files.length === 1, '照片只列 1 个文件')
assert(byPath[cMp4]?.files.length === 2, '第二个视频同样 2 个文件')
assert(
  plan.every((i) => i.files.every((f) => f.path.toLowerCase().startsWith(root.toLowerCase() + '\\'))),
  '所有待删文件都在 root 内'
)
assert(byPath[aMp4].files.every((f) => f.exists && f.size > 0), '预览标记 exists/size')
assert(
  byPath[aMp4].files.some((f) => f.path.toLowerCase().endsWith('.lrf')),
  '清单包含 LRF 代理文件'
)
assert(buildPurgePlan([xNotTrashed], root).length === 0, '拒绝：未移入回收站')
assert(buildPurgePlan([yEscape], root).length === 0, '拒绝：目录穿越到 root 外')
assert(buildPurgePlan([zTxt], root).length === 0, '拒绝：扩展名不在白名单')
assert(buildPurgePlan([ghost], root).length === 0, '拒绝：不在 files 索引')
assert(buildPurgePlan([fLrf], root)[0]?.files.length === 1, '孤儿 LRF 去重为 1 个文件')
assert(buildPurgePlan([dMp4], root)[0]?.files[0]?.exists === false, '物理文件缺失标记 exists=false')
const mixedPlan = buildPurgePlan([aMp4, ghost, xNotTrashed], root)
assert(
  mixedPlan.length === 1 &&
  [...new Set([aMp4, ghost, xNotTrashed])].filter((p) => !mixedPlan.some((i) => i.path === p)).length === 2,
  'rejected 计算：合法 1 项、被拒 2 项'
)

console.log('\n--- executePurge（真实 unlink + 清库） ---')
const r1 = executePurge([aMp4, bJpg], root)
assert(r1.total === 2 && r1.succeeded === 2 && r1.failed === 0, '批量删除 2 个媒体全成功', JSON.stringify(r1))
assert(!existsSync(aMp4) && !existsSync(aLrf), 'A 的 mp4 与 lrf 都真实删除')
assert(!existsSync(bJpg), 'B 的 jpg 真实删除')
assert(existsSync(cMp4) && existsSync(cLrf), '未选中的 C 文件完好')
assert(existsSync(xNotTrashed) && existsSync(zTxt), '白名单反例文件未被误删')
assert(r1.bytes === 1024 + 256 + 512, 'bytes 统计正确', String(r1.bytes))
assert(!inFiles.get(aMp4) && !inFiles.get(bJpg), 'A/B 从 files 清除')
assert(!inTrash.get(aMp4) && !inTrash.get(bJpg), 'A/B 从 trash 清除')
assert(!inFav.get(aMp4) && !inFav.get(bJpg), 'A/B 从 favorites 清除')
assert(inFiles.get(cMp4) && inTrash.get(cMp4) && inFav.get(cMp4), 'C 三表记录保留')
assert(!existsSync(join(thumbs, aThumb)) && existsSync(join(thumbs, cThumb)), 'A 缩略图缓存删除、C 保留')
assert(
  r1.items.every((i) => i.deleted.length === (i.path === aMp4 ? 2 : 1)),
  '结果逐项列出 deleted 明细'
)
assert(executePurge([aMp4], root).total === 0, '已清除的记录重复调用为空操作')

console.log('\n--- 幂等 / 部分失败 / 重试收敛 ---')
const rD = executePurge([dMp4], root)
assert(rD.succeeded === 1 && rD.failed === 0 && !inTrash.get(dMp4), '文件已不存在视为已删，清库成功（幂等）')
const rE = executePurge([eMp4], root)
assert(rE.succeeded === 0 && rE.failed === 1, '单个关联文件删除失败 → 整体失败', JSON.stringify(rE))
assert(!existsSync(eMp4), '失败项：mp4 已删')
assert(inTrash.get(eMp4) && inFiles.get(eMp4), '失败项：DB 不清库、仍留在回收站')
assert(rE.items[0].failed.length === 1 && rE.items[0].failed[0].error.length > 0, '失败原因逐项返回')
try { rmSync(eLrfDir, { recursive: true, force: true }) } catch { /* ignore */ }
if (existsSync(eLrfDir)) {
  // 沙箱可能拦截目录删除：解除关联，同样验证「已删文件幂等 + 重试收敛」
  db.prepare('UPDATE files SET lrf_path = NULL WHERE path = ?').run(eMp4)
}
const rE2 = executePurge([eMp4], root)
assert(rE2.succeeded === 1 && !inTrash.get(eMp4), '移除障碍后重试收敛成功')

console.log('\n--- 批量混合 & 越界硬校验 ---')
const gMp4 = join(d21, 'DJI_G.mp4')
const gLrf = join(d21, 'DJI_G.LRF')
const hMp4 = join(d21, 'DJI_H.mp4')
const hLrfDir = join(d21, 'DJI_H.LRF')
writeFileSync(gMp4, Buffer.alloc(16))
writeFileSync(gLrf, Buffer.alloc(8))
writeFileSync(hMp4, Buffer.alloc(16))
mkdirSync(hLrfDir)
addRow(gMp4, { size: 16, lrf: gLrf })
addRow(hMp4, { size: 16, lrf: hLrfDir })
const rMix = executePurge([gMp4, hMp4], root)
assert(rMix.succeeded === 1 && rMix.failed === 1, '批量中成功与失败互不干扰', JSON.stringify(rMix))
assert(!inTrash.get(gMp4) && inTrash.get(hMp4), '成功的清库、失败的保留')
assert(executePurge([yEscape, zTxt, xNotTrashed, ghost], root).total === 0, '全非法路径不执行任何删除')
assert(existsSync(zTxt) && existsSync(xNotTrashed), '越界/白名单文件始终完好')

try { rmSync(root, { recursive: true, force: true }) } catch { /* 沙箱删除保护，忽略 */ }
console.log(`\n${pass} passed, ${failed} failed`)
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
if (failed > 0) process.exit(1)
