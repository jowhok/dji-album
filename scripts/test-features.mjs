import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { parseProbeOutput, colsForWidth, distributeRows } = require('../.tmp/test-features.cjs')

let passed = 0
let failed = 0
function ok(cond, label) {
  if (cond) { passed++; console.log('  PASS', label) }
  else { failed++; console.log('  FAIL', label) }
}
function eq(a, b, label) { ok(Object.is(a, b), `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`) }

const SAMPLE_4K = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'DJI_0001.MP4':
  Metadata:
    major_brand     : isom
  Duration: 00:01:23.45, start: 0.000000, bitrate: 12300 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 3840x2160 [SAR 1:1 DAR 16:9], 12300 kb/s, 59.94 fps, 59.94 tbr, 60k tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)
At least one output file must be specified.`

console.log('--- ffmpeg 元数据解析 ---')
const a = parseProbeOutput(SAMPLE_4K)
eq(a.duration, 83.45, '时长 00:01:23.45 -> 83.45s')
eq(a.width, 3840, '宽 3840（不被 0x31637661 / 0x1 干扰）')
eq(a.height, 2160, '高 2160')
eq(a.fps, 59.94, '帧率 59.94 fps')
eq(a.vcodec, 'h264', '视频编码 h264')
eq(a.acodec, 'aac', '音频编码 aac')
eq(a.bitrate, 12300, '码率 12300 kb/s')

const SAMPLE_SHORT = `  Duration: 00:00:00.30, start: 0.000000, bitrate: 900 kb/s
  Stream #0:0: Video: hevc (Main), yuv420p, 1280x720, 900 kb/s, 30 tbr, 30k tbn`
const b = parseProbeOutput(SAMPLE_SHORT)
eq(b.duration, 0.3, '极短视频 0.30s')
eq(b.fps, 30, '无 fps 字段时回退 tbr')
eq(b.vcodec, 'hevc', '视频编码 hevc')
eq(b.acodec, null, '无音轨时 acodec 为 null')
eq(b.width, 1280, '分辨率 1280x720')

const c = parseProbeOutput('')
eq(c.duration, null, '空输出 duration 为 null')
eq(c.width, null, '空输出 width 为 null')

const d = parseProbeOutput('  Duration: 01:23:45.00, start: 0.000000, bitrate: 500 kb/s')
eq(d.duration, 5025, '带小时的时间 1:23:45 -> 5025s')

console.log('--- 横向瀑布流布局 ---')
eq(colsForWidth(1400), 4, '1400px -> 4 列')
eq(colsForWidth(980), 4, '980px 边界 -> 4 列')
eq(colsForWidth(979), 3, '979px -> 3 列')
eq(colsForWidth(1019), 4, '1019px（加宽侧边栏后的真实宽度）-> 4 列')
eq(colsForWidth(760), 3, '760px -> 3 列')
eq(colsForWidth(759), 2, '759px -> 2 列')
eq(colsForWidth(500), 2, '500px -> 2 列')
eq(colsForWidth(499), 1, '499px -> 1 列')
eq(colsForWidth(0), 1, '0px 兜底 1 列')
eq(colsForWidth(NaN), 1, 'NaN 兜底 1 列')

const rows = distributeRows([0, 1, 2, 3, 4, 5, 6], 4)
eq(rows.length, 4, '7 项 / 4 列 -> 4 个列容器')
eq(JSON.stringify(rows[0]), '[0,4]', '第 1 列 [0,4]')
eq(JSON.stringify(rows[1]), '[1,5]', '第 2 列 [1,5]')
eq(JSON.stringify(rows[2]), '[2,6]', '第 3 列 [2,6]')
eq(JSON.stringify(rows[3]), '[3]', '第 4 列 [3]')

// 按行读回：第 r 行取每列第 r 个元素，应与原数组顺序一致
const readBack = []
for (let r = 0; r < Math.max(...rows.map((x) => x.length)); r++) {
  for (const col of rows) if (col[r] !== undefined) readBack.push(col[r])
}
eq(JSON.stringify(readBack), '[0,1,2,3,4,5,6]', '横向阅读顺序还原 = 原始顺序（行优先）')

eq(JSON.stringify(distributeRows([1, 2, 3], 1)), '[[1,2,3]]', '单列保持原序')
eq(distributeRows([], 4).length, 4, '空数组仍生成 4 个空列')
eq(distributeRows([1], 99).length, 8, '列数上限钳制到 8')

console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${passed} assertions)`)
if (failed > 0) process.exit(1)
