/**
 * 生成 Windows 应用图标（build/icon.ico + build/icon.png）
 * 素材：assets/dji-wordmark.svg —— DJI 官方 "dji" 字标矢量
 *      assets/dji-favicon-original.ico —— DJI 官网 favicon（原始官方位图，仅作来源留痕）
 *
 * ICO 内使用 32bpp BMP(DIB) 图像，兼容 rcedit / NSIS / 所有 Windows 版本。
 * 运行：npm run icons
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'build')
mkdirSync(outDir, { recursive: true })

const wordmark = readFileSync(join(root, 'assets/dji-wordmark.svg'), 'utf8')
const pathD = wordmark.match(/<path\s+d="([^"]+)"/)?.[1]
if (!pathD) throw new Error('未能从 assets/dji-wordmark.svg 提取 path')

// 512 画布：近黑圆角底 + 白色官方字标居中（占宽约 74%，不贴边）
const S = 512
const scale = 380 / 24
const tx = (S - 24 * scale) / 2
const ty = (S - 24 * scale) / 2
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <rect x="0" y="0" width="${S}" height="${S}" rx="96" ry="96" fill="#111214"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})"><path fill="#ffffff" d="${pathD}"/></g>
</svg>`

async function render(size) {
  return await sharp(Buffer.from(iconSvg)).resize(size, size).png().toBuffer()
}

// 32bpp DIB：BITMAPINFOHEADER + 自底向上 BGRA 像素 + AND mask
function toDib(rgba, w, h) {
  const header = Buffer.alloc(40)
  const maskRow = Math.ceil(w / 32) * 4
  const maskSize = maskRow * h
  const pixels = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4
      const d = (y * w + x) * 4
      pixels[d] = rgba[s + 2]
      pixels[d + 1] = rgba[s + 1]
      pixels[d + 2] = rgba[s]
      pixels[d + 3] = rgba[s + 3]
    }
  }
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(w, 4)
  header.writeInt32LE(h * 2, 8) // XOR bitmap + AND mask
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16) // BI_RGB
  header.writeUInt32LE(pixels.length + maskSize, 20)
  return Buffer.concat([header, pixels, Buffer.alloc(maskSize)])
}

function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // ICONDIR
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + dir.length
  entries.forEach((e, i) => {
    const b = i * 16
    dir.writeUInt8(e.w >= 256 ? 0 : e.w, b)
    dir.writeUInt8(e.h >= 256 ? 0 : e.h, b + 1)
    dir.writeUInt8(0, b + 2)
    dir.writeUInt8(0, b + 3)
    dir.writeUInt16LE(1, b + 4)
    dir.writeUInt16LE(32, b + 6)
    dir.writeUInt32LE(e.data.length, b + 8)
    dir.writeUInt32LE(offset, b + 12)
    offset += e.data.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.data)])
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const entries = []
for (const s of sizes) {
  const png = await render(s)
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  entries.push({ w: s, h: s, data: toDib(data, info.width, info.height) })
}
const ico = buildIco(entries)
writeFileSync(join(outDir, 'icon.ico'), ico)
writeFileSync(join(outDir, 'icon.png'), await render(512))
writeFileSync(join(outDir, 'icon-preview.png'), await render(256))
console.log(`icon.ico  ${ico.length} bytes, sizes: ${sizes.join('/')}`)
console.log(`icon.png  512x512, icon-preview.png 256x256`)
