// Production server: the built UI from dist/ plus the same API the dev server mounts.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApi } from './api.mjs'
import { loadDotEnv } from './env.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(root)
const dist = join(root, 'dist')
const api = createApi(root)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }

function serveStatic(req, res) {
  const pathname = normalize(decodeURIComponent(new URL(req.url, 'http://localhost').pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(dist, pathname)
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html')
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
  createReadStream(file).pipe(res)
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ is missing: run `npm run build` first, or `npm run dev` for development.')
  process.exit(1)
}

const port = Number(process.env.PORT ?? 4317)
createServer((req, res) => api(req, res, () => serveStatic(req, res))).listen(port, () => {
  console.log(`Roblox Thumbnail Maker on http://localhost:${port}`)
})
