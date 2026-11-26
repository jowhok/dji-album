import { createRequire } from 'module'
import { writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const require = createRequire(import.meta.url)
const { parseRange, startMediaServer, stopMediaServer, registerMediaFile, getMediaPort } =
  require('../.tmp/test-media.cjs')

let passed = 0
let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) { passed++; console.log('  PASS', label) }
  else { failed++; console.log('  FAIL', label, extra) }
}
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), label, `(got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`)

console.log('--- parseRange 纯函数 ---')
eq(parseRange(undefined, 1000), null, '无 Range 头 -> null')
eq(parseRange('bytes=0-99', 1000), { start: 0, end: 99 }, '普通区间')
eq(parseRange('bytes=100-', 1000), { start: 100, end: 999 }, '开放结尾')
eq(parseRange('bytes=-500', 1000), { start: 500, end: 999 }, '后缀区间')
eq(parseRange('bytes=-2000', 1000), { start: 0, end: 999 }, '后缀超过文件大小钳制')
eq(parseRange('bytes=999-2000', 1000), { start: 999, end: 999 }, '结尾超过文件大小钳制')
eq(parseRange('bytes=1000-', 1000), 'invalid', '起点 == 文件大小 -> 416')
eq(parseRange('bytes=2000-3000', 1000), 'invalid', '起点越界 -> 416')
eq(parseRange('bytes=50-40', 1000), 'invalid', '起点大于终点 -> 416')
eq(parseRange('bytes=-0', 1000), 'invalid', '后缀为 0 -> 416')
eq(parseRange('bytes=-', 1000), 'invalid', '空区间 -> 416')
eq(parseRange('bytes=abc-def', 1000), 'invalid', '非法数字 -> 416')
eq(parseRange('bytes=0-99,200-299', 1000), 'invalid', 'multipart 不支持 -> 416')
eq(parseRange('bytes=0-9', 0), 'invalid', '空文件 -> 416')

console.log('--- HTTP 端到端（真实 Range 响应）---')
const file = join(tmpdir(), `dji-range-test-${Date.now()}.bin`)
const payload = Buffer.alloc(1000)
for (let i = 0; i < 1000; i++) payload[i] = i % 251
writeFileSync(file, payload)

const port = await startMediaServer()
const base = `http://127.0.0.1:${port}`
const url = base + registerMediaFile(file)
ok(getMediaPort() === port, '服务端口可获取')

const full = await fetch(url)
const fullBuf = Buffer.from(await full.arrayBuffer())
eq(full.status, 200, '无 Range -> 200')
eq(full.headers.get('accept-ranges'), 'bytes', '响应带 Accept-Ranges')
eq(fullBuf.length, 1000, '200 返回全文 1000 字节')
ok(fullBuf.equals(payload), '全文内容一致')

const part = await fetch(url, { headers: { Range: 'bytes=0-99' } })
const partBuf = Buffer.from(await part.arrayBuffer())
eq(part.status, 206, 'Range 请求 -> 206')
eq(part.headers.get('content-range'), 'bytes 0-99/1000', 'Content-Range 正确')
eq(partBuf.length, 100, '206 返回 100 字节')
ok(partBuf.equals(payload.subarray(0, 100)), '分片内容一致')

const tail = await fetch(url, { headers: { Range: 'bytes=-50' } })
const tailBuf = Buffer.from(await tail.arrayBuffer())
eq(tail.status, 206, '后缀 Range -> 206')
eq(tail.headers.get('content-range'), 'bytes 950-999/1000', '后缀 Content-Range 正确')
ok(tailBuf.equals(payload.subarray(950)), '后缀内容一致')

const bad = await fetch(url, { headers: { Range: 'bytes=2000-' } })
eq(bad.status, 416, '越界 Range -> 416')
eq(bad.headers.get('content-range'), 'bytes */1000', '416 Content-Range 正确')

const head = await fetch(url, { method: 'HEAD' })
eq(head.status, 200, 'HEAD -> 200')
eq((await head.arrayBuffer()).byteLength, 0, 'HEAD 无响应体')

const unknown = await fetch(base + '/media/' + 'a'.repeat(40))
eq(unknown.status, 404, '未登记 token -> 404（防任意文件读取）')
const malformed = await fetch(base + '/media/not-a-token')
eq(malformed.status, 400, '非法 token -> 400')

stopMediaServer()
try { rmSync(file, { force: true }) } catch { /* 沙箱可能拦截删除，忽略 */ }

console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${passed} assertions)`)
if (failed > 0) process.exit(1)
