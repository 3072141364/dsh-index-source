#!/usr/bin/env node
/**
 * 把当前目录当静态站点发布，方便先用 http://127.0.0.1:8787/index.json 试索引。
 * 零依赖：node serve.mjs [--port 8787] [--host 127.0.0.1]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const port = Number(option('port', process.env.PORT ?? 8787))
const host = option('host', '127.0.0.1')
const root = path.dirname(new URL(import.meta.url).pathname)
const TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
}

const server = http.createServer((request, response) => {
  const started = Date.now()
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? host}`)
  let target = path.resolve(root, `.${decodeURIComponent(url.pathname)}`)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('forbidden')
    return
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html')
  fs.readFile(target, (error, body) => {
    if (error) {
      console.log(`${request.method} ${url.pathname} 404 ${Date.now() - started}ms`)
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
      return
    }
    console.log(`${request.method} ${url.pathname} 200 ${body.length}B ${Date.now() - started}ms`)
    response.writeHead(200, {
      'content-type': TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'referrer-policy': 'no-referrer',
    })
    response.end(body)
  })
})

server.listen(port, host, () => {
  console.log(`索引源预览：http://${host}:${port}/index.json`)
  console.log(`图标目录：  http://${host}:${port}/icons/`)
  console.log('把上面的 index.json 地址粘到「插件 → 发现 → 添加索引源」。Ctrl+C 停止。')
})
