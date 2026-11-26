import { createRequire } from 'module'
import { mkdtempSync, mkdirSync, existsSync, statSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'

const require = createRequire(import.meta.url)
const { initDb, getDb } = require('../.tmp/test-thumbs.cjs')
const { generateAllThumbs, setThumbsDir } = require('../.tmp/test-thumbs.cjs')
const sharp = require('sharp')
const ffmpeg = require('ffmpeg-static')

const root = mkdtempSync(join(tmpdir(), 'thumbs-'))
const thumbsDir = join(root, 'thumbs')
mkdirSync(thumbsDir, { recursive: true })
const photo = join(root, 'test.jpg')
const video = join(root, 'test.mp4')
const shortVideo = join(root, 'short.mp4')

await sharp({ create: { width: 640, height: 480, channels: 3, background: '#336699' } })
  .jpeg()
  .toFile(photo)
execFileSync(
  ffmpeg,
  [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10',
    '-pix_fmt', 'yuv420p', '-y', video
  ],
  { timeout: 30000 }
)
execFileSync(
  ffmpeg,
  [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=duration=0.3:size=320x240:rate=10',
    '-pix_fmt', 'yuv420p', '-y', shortVideo
  ],
  { timeout: 30000 }
)

initDb(':memory:')
const db = getDb()
const ins = db.prepare(
  'INSERT INTO files (path,name,type,dir_date,size,taken_at,thumb,lrf_path,indexed_at) VALUES (?,?,?,?,?,?,?,?,?)'
)
ins.run(photo, 'test.jpg', 'photo', '20261120', statSync(photo).size, Date.now(), null, null, Date.now())
ins.run(video, 'test.mp4', 'video', '20261120', statSync(video).size, Date.now(), null, null, Date.now())
ins.run(shortVideo, 'short.mp4', 'video', '20261120', statSync(shortVideo).size, Date.now(), null, null, Date.now())
setThumbsDir(thumbsDir)

let failed = 0
function assert(cond, msg) {
  if (cond) console.log(`PASS ${msg}`)
  else { failed++; console.error(`FAIL ${msg}`) }
}

const r = await generateAllThumbs()
assert(r.total === 3, `total = 3 (got ${r.total})`)
assert(r.done === 3 && r.succeeded === 3 && r.failed === 0, `3 succeeded 0 failed incl. 0.3s clip (got ${r.succeeded}/${r.failed})`)

const rows = db.prepare('SELECT path, thumb FROM files').all()
assert(rows.every((x) => x.thumb && existsSync(join(thumbsDir, x.thumb))), 'all thumb files exist')
const meta = await sharp(join(thumbsDir, rows[0].thumb)).metadata()
assert(meta.width === 360, `photo resized to 360px (got ${meta.width})`)
assert(meta.format === 'jpeg', 'thumb is jpeg')

const again = await generateAllThumbs()
assert(again.total === 0, `second run skips all cached (got ${again.total})`)

try { rmSync(root, { recursive: true, force: true }) } catch { /* 临时目录清理失败不影响结论 */ }
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
