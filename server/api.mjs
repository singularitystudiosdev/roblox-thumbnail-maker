// Connect-style middleware shared by the Vite dev server and the production server.
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { config } from './env.mjs'
import { generateThumbnail, OUTPUT_RESOLUTION } from './imagegen.mjs'
import { fallbackReference, planThumbnail, referenceFor } from './planner.mjs'
import { buildPrompt } from './prompt.mjs'
import { downloadThumbnail, GameNotFound, isAllowedReferenceUrl } from './roblox.mjs'

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

/** The bundled reference, used when Roblox search finds nothing usable. */
function referenceFile(root) {
  const file = join(root, config().referenceImage)
  if (!existsSync(file)) throw new Error(`Reference image not found at ${config().referenceImage}. Set REFERENCE_IMAGE in .env.`)
  return { file, mimeType: MIME[extname(file).toLowerCase()] ?? 'image/png' }
}

async function referenceImage(root, reference) {
  if (reference.source === 'roblox') return downloadThumbnail(reference.thumbnailUrl)
  const { file, mimeType } = referenceFile(root)
  return { bytes: readFileSync(file), mimeType }
}

/** A reference the page sends back is reused only when it is a Roblox CDN thumbnail; anything else is looked up again. */
function trustedReference(value) {
  if (value?.source !== 'roblox' || !isAllowedReferenceUrl(value.thumbnailUrl)) return null
  const { universeId, placeId, name, playing, url, thumbnailUrl, nearCount, query } = value
  return {
    source: 'roblox',
    universeId,
    placeId,
    name: String(name ?? ''),
    playing: Number(playing) || 0,
    url,
    thumbnailUrl,
    nearCount,
    query: typeof query === 'string' ? query : undefined
  }
}

/** The game the title was written from, kept only when its link is a roblox.com game page. */
function describedFromOf(value) {
  if (typeof value?.url !== 'string' || !/^https:\/\/www\.roblox\.com\/games\/\d+/.test(value.url)) return null
  return { name: String(value.name ?? ''), url: value.url, playing: Number(value.playing) || 0 }
}

function listHistory(outputsDir, limit = 40) {
  return readdirSync(outputsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(outputsDir, f), 'utf8')))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

async function handleGenerate(req, root, outputsDir) {
  const body = await readJson(req)
  const { gameName } = body
  if (typeof gameName !== 'string' || !gameName.trim()) throw new BadRequest('Give the game a name first.')
  const prompt = buildPrompt(gameName)
  const reference =
    body.reference?.source === 'fallback' ? fallbackReference(body.reference.query) : trustedReference(body.reference) ?? (await referenceFor(gameName))
  const started = Date.now()
  const result = await generateThumbnail(prompt, await referenceImage(root, reference))
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
    reference,
    describedFrom: describedFromOf(body.describedFrom),
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
        const { prompt, keepName } = await readJson(req)
        if (typeof prompt !== 'string' || !prompt.trim()) throw new BadRequest('Type your game name or paste its Roblox link first.')
        return sendJson(res, 200, await planThumbnail(prompt, { keepName: keepName === true }))
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
          textModel: c.textModel,
          falTextModel: c.falTextModel,
          fallbackReferenceName: c.referenceName
        })
      }
      return sendJson(res, 404, { error: `No route ${route}` })
    } catch (err) {
      if (err instanceof BadRequest || err instanceof GameNotFound) return sendJson(res, 400, { error: err.message })
      console.error(`API ${req.method} ${url.pathname} failed:`, err)
      return sendJson(res, 502, { error: err.message })
    }
  }
}
