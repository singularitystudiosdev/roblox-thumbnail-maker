// Connect-style middleware shared by the Vite dev server and the production server.
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { config } from './env.mjs'
import { generateThumbnail, OUTPUT_RESOLUTION } from './imagegen.mjs'
import { buildPrompt, extractGameName } from './prompt.mjs'

const MAX_BODY = 64 * 1024
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

class BadRequest extends Error {}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new BadRequest('Request body too large.')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new BadRequest('Request body is not valid JSON.')
  }
}

/** The fixed style reference every thumbnail is generated from. */
function referenceFile(root) {
  const file = join(root, config().referenceImage)
  if (!existsSync(file)) throw new Error(`Reference image not found at ${config().referenceImage}. Set REFERENCE_IMAGE in .env.`)
  return { file, mimeType: MIME[extname(file).toLowerCase()] ?? 'image/png' }
}

function listHistory(outputsDir, limit = 40) {
  return readdirSync(outputsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(outputsDir, f), 'utf8')))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

async function handleGenerate(req, root, outputsDir) {
  const { gameName } = await readJson(req)
  if (typeof gameName !== 'string' || !gameName.trim()) throw new BadRequest('Give the game a name first.')
  const prompt = buildPrompt(gameName)
  const { file, mimeType } = referenceFile(root)
  const started = Date.now()
  const result = await generateThumbnail(prompt, { bytes: readFileSync(file), mimeType })
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const ext = result.mimeType === 'image/jpeg' ? 'jpg' : 'png'
  writeFileSync(join(outputsDir, `${id}.${ext}`), result.bytes)
  const record = {
    id,
    createdAt: new Date().toISOString(),
    imageUrl: `/outputs/${id}.${ext}`,
    gameName: gameName.trim(),
    prompt,
    resolution: OUTPUT_RESOLUTION,
    reference: { name: config().referenceName, file: config().referenceImage },
    provider: result.provider,
    model: result.model,
    ms: Date.now() - started
  }
  writeFileSync(join(outputsDir, `${id}.json`), JSON.stringify(record, null, 2))
  return record
}

function serveImage(res, file, mimeType, cache) {
  res.setHeader('Content-Type', mimeType)
  res.setHeader('Cache-Control', cache)
  createReadStream(file).pipe(res)
}

function serveOutput(res, outputsDir, pathname) {
  const file = join(outputsDir, basename(decodeURIComponent(pathname)))
  if (!existsSync(file) || file.endsWith('.json')) return sendJson(res, 404, { error: 'Not found' })
  serveImage(res, file, MIME[extname(file)] ?? 'image/png', 'public, max-age=31536000, immutable')
}

export function createApi(root) {
  const outputsDir = join(root, 'outputs')
  mkdirSync(outputsDir, { recursive: true })

  return async function api(req, res, next) {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname.startsWith('/outputs/')) return serveOutput(res, outputsDir, url.pathname)
    if (!url.pathname.startsWith('/api/')) return next()
    try {
      const route = `${req.method} ${url.pathname}`
      if (route === 'POST /api/plan') {
        const { prompt } = await readJson(req)
        if (typeof prompt !== 'string' || !prompt.trim()) throw new BadRequest('Type your game name first.')
        const gameName = extractGameName(prompt)
        return sendJson(res, 200, { gameName, prompt: buildPrompt(gameName) })
      }
      if (route === 'POST /api/generate') return sendJson(res, 200, await handleGenerate(req, root, outputsDir))
      if (route === 'GET /api/reference') {
        const { file, mimeType } = referenceFile(root)
        return serveImage(res, file, mimeType, 'no-cache')
      }
      if (route === 'GET /api/history') return sendJson(res, 200, { items: listHistory(outputsDir) })
      if (route === 'GET /api/status') {
        const c = config()
        return sendJson(res, 200, {
          geminiKeys: c.geminiKeys.length,
          falKeys: c.falKeys.length,
          imageProvider: c.imageProvider,
          imageModel: c.imageModel,
          falModel: c.falModel,
          referenceName: c.referenceName,
          referenceUrl: '/api/reference'
        })
      }
      return sendJson(res, 404, { error: `No route ${route}` })
    } catch (err) {
      if (err instanceof BadRequest) return sendJson(res, 400, { error: err.message })
      console.error(`API ${req.method} ${url.pathname} failed:`, err)
      return sendJson(res, 502, { error: err.message })
    }
  }
}
