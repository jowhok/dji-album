import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { createReadStream, existsSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { createHash } from 'crypto'
import { getThumbsDir } from './thumbnails'
import { parseRange } from './range'

export { parseRange } from './range'

let server: Server | null = null
let port = 0

/** token -> 真实文件路径，只登记由主进程白名单校验过的文件 */
const mediaFiles = new Map<string, string>()

export function registerMediaFile(path: string): string {
  const token = createHash('sha1').update(path).digest('hex')
  mediaFiles.set(token, path)
  return `/media/${token}`
}

export function unregisterMediaFile(path: string): void {
  mediaFiles.delete(createHash('sha1').update(path).digest('hex'))
}


function contentType(path: string): string {
  const ext = extname(path).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  return 'video/mp4' // .mp4 与 DJI 的 .lrf 代理都是 MP4 容器
}

function serveMedia(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const token = pathname.slice('/media/'.length)
  if (!/^[a-f0-9]{40}$/.test(token)) {
    res.writeHead(400)
    res.end()
    return
  }
  const file = mediaFiles.get(token)
  if (!file || !existsSync(file)) {
    res.writeHead(404)
    res.end()
    return
  }

  let size: number
  try {
    size = statSync(file).size
  } catch {
    res.writeHead(404)
    res.end()
    return
  }

  const range = parseRange(req.headers.range, size)
  if (range === 'invalid') {
    res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' })
    res.end()
    return
  }

  const headers: Record<string, string | number> = {
    'Content-Type': contentType(file),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  }
  const opts = range ? { start: range.start, end: range.end } : undefined

  if (range) {
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Content-Length': range.end - range.start + 1
    })
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size })
  }

  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(file, opts)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

export function startMediaServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')

      if (url.pathname === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
        return
      }

      if (url.pathname.startsWith('/media/')) {
        serveMedia(req, res, url.pathname)
        return
      }

      if (url.pathname.startsWith('/thumb/')) {
        const name = basename(decodeURIComponent(url.pathname.slice(7)))
        if (!/^[a-f0-9]{40}\.jpg$/.test(name)) {
          res.writeHead(400)
          res.end()
          return
        }
        const file = join(getThumbsDir(), name)
        let size: number
        try {
          size = statSync(file).size
        } catch {
          res.writeHead(404)
          res.end()
          return
        }
        // 带 Content-Length，避免 chunked 让浏览器等到流结束才能确定图片完整
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': size,
          'Cache-Control': 'public, max-age=86400'
        })
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        const stream = createReadStream(file)
        stream.on('error', () => res.destroy())
        stream.pipe(res)
        return
      }

      res.writeHead(404)
      res.end()
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server?.address()
      port = typeof addr === 'object' && addr ? addr.port : 0
      resolve(port)
    })
  })
}

export function getMediaPort(): number {
  return port
}

export function stopMediaServer(): void {
  server?.close()
  server = null
  mediaFiles.clear()
}
