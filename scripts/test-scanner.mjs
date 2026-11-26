import { createRequire } from 'module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const require = createRequire(import.meta.url)
const { initDb, getDb } = require('../.tmp/test-entry.cjs')
const { scanRoot } = require('../.tmp/test-entry.cjs')

const root = mkdtempSync(join(tmpdir(), 'nas-'))
const mk = (dir, name) => writeFileSync(join(root, dir, name), 'x')

mkdirSync(join(root, '20261120'), { recursive: true })
mkdirSync(join(root, '20261118'), { recursive: true })
mkdirSync(join(root, 'not-a-date'), { recursive: true })

mk('20261120', 'DJI_001.mp4')
mk('20261120', 'DJI_001.lrf')
mk('20261120', 'DJI_002.mp4')
mk('20261120', 'DJI_003.lrf')
mk('20261120', 'IMG_01.jpg')
mk('20261118', 'DJI_004.mp4')
mk('20261118', 'DJI_004.lrf')
mk('20261118', 'IMG_02.jpg')
mk('not-a-date', 'DJI_005.mp4')

initDb(':memory:')
const result = await scanRoot(root, (p) => process.stdout.write(`progress ${p.done}/${p.total} ${p.current}\n`))

const rows = getDb().prepare('SELECT * FROM files ORDER BY name').all()
const byName = Object.fromEntries(rows.map((r) => [r.name, r]))

let failed = 0
function assert(cond, msg) {
  if (cond) console.log(`PASS ${msg}`)
  else { failed++; console.error(`FAIL ${msg}`) }
}

assert(result.videos === 4, `videos = 4 (got ${result.videos})`)
assert(result.photos === 2, `photos = 2 (got ${result.photos})`)
assert(result.dirs === 2, `dirs = 2 (got ${result.dirs})`)
assert(rows.length === 6, `total rows = 6 (got ${rows.length})`)
assert(!!byName['DJI_001.mp4'] && byName['DJI_001.mp4'].lrf_path?.endsWith('DJI_001.lrf'), 'DJI_001 mp4 paired with lrf')
assert(!!byName['DJI_002.mp4'] && byName['DJI_002.mp4'].lrf_path === null, 'DJI_002 has no lrf')
assert(!!byName['DJI_003.lrf'] && byName['DJI_003.lrf'].type === 'video', 'orphan lrf kept as video')
assert(!!byName['IMG_01.jpg'] && byName['IMG_01.jpg'].type === 'photo', 'jpg indexed as photo')
assert(!byName['DJI_005.mp4'], 'non-date dir ignored')

try { rmSync(root, { recursive: true, force: true }) } catch { /* 临时目录清理失败不影响结论 */ }
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
