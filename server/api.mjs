// Connect-style middleware shared by the Vite dev server and the production server.
import { createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { config } from './env.mjs'
import { imageMimeType } from './mime.mjs'
import { IMAGE_MODEL_LABEL } from './imagemodels.mjs'
import { PLAIN_TEMPLATE, PROMPT_TEMPLATE, REMIX_COUNT, REMIX_PROMPT } from './prompt.mjs'
import { GameNotFound } from './roblox.mjs'
import { listRuns, rejudgeRun, RUN_ID, runThumbnails } from './run.mjs'

const MAX_BODY = 12 * 1024 * 1024
const MAX_STYLE_BYTES = 8 * 1024 * 1024
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
const STYLE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/
const OUTPUT_FILE = /^[\w-]+\.(?:png|jpg|webp)$/

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

/** The bundled style reference thumbnail 1 is made "in the style of". */
function bundledStyle(root) {
  const file = join(root, config().styleReference)
  if (!existsSync(file)) throw new Error(`Style reference not found at ${config().styleReference}. Set STYLE_REFERENCE in .env.`)
  return { file, mimeType: MIME[extname(file).toLowerCase()] ?? 'image/png' }
}

/** An uploaded style image (a data URL from the page), or the bundled one. */
function styleFor(root, upload) {
  if (upload == null) {
    const { file, mimeType } = bundledStyle(root)
    return { bytes: readFileSync(file), mimeType, name: config().styleReferenceName, source: 'bundled' }
  }
  const match = typeof upload.dataUrl === 'string' ? upload.dataUrl.match(STYLE_DATA_URL) : null
  if (!match) throw new BadRequest('The style image must be a PNG, JPEG or WebP.')
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length > MAX_STYLE_BYTES) throw new BadRequest('The style image is over 8 MB.')
  const name = String(upload.name ?? '').trim().slice(0, 120) || 'Your reference image'
  return { bytes, mimeType: imageMimeType(bytes, match[1]), name, source: 'upload' }
}

/** Streams the run as NDJSON events: plan, reference, thumbnail (x3), judging, judge, done; or error. */
async function handleRun(req, res, root, outputsDir) {
  const body = await readJson(req)
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new BadRequest('Type your game name, a description or its Roblox link first.')
  if (body.prompt.length > 2000) throw new BadRequest('Keep the prompt under 2000 characters.')
  const style = styleFor(root, body.style)

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.flushHeaders?.()
  // A closed tab stops the stream, not the run: it still finishes and lands in history.
  const emit = (event) => {
    if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`)
  }
  try {
    await runThumbnails({ input: body.prompt.trim(), style, outputsDir, emit })
  } catch (err) {
    if (!(err instanceof GameNotFound)) console.error('Run failed:', err)
    emit({ type: 'error', error: err.message })
  } finally {
    res.end()
  }
}

function serveImage(res, file, mimeType, cache) {
  res.setHeader('Content-Type', mimeType)
  res.setHeader('Cache-Control', cache)
  createReadStream(file).pipe(res)
}

function serveOutput(res, outputsDir, pathname) {
  const [runId, file] = decodeURIComponent(pathname).replace(/^\/outputs\//, '').split('/')
  const path = RUN_ID.test(runId ?? '') && OUTPUT_FILE.test(file ?? '') ? join(outputsDir, runId, file) : null
  if (!path || !existsSync(path)) return sendJson(res, 404, { error: 'Not found' })
  serveImage(res, path, MIME[extname(path)] ?? 'image/png', 'public, max-age=31536000, immutable')
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
      if (route === 'POST /api/run') return await handleRun(req, res, root, outputsDir)
      if (route === 'GET /api/runs') return sendJson(res, 200, { items: listRuns(outputsDir) })
      const rejudge = req.method === 'POST' && url.pathname.match(/^\/api\/runs\/([^/]+)\/judge$/)
      if (rejudge) {
        const record = await rejudgeRun(outputsDir, decodeURIComponent(rejudge[1]))
        return record ? sendJson(res, 200, record) : sendJson(res, 404, { error: 'No such run.' })
      }
      if (route === 'GET /api/style-reference') {
        const { file, mimeType } = bundledStyle(root)
        return serveImage(res, file, mimeType, 'no-cache')
      }
      if (route === 'GET /api/status') {
        const c = config()
        return sendJson(res, 200, {
          geminiKeys: c.geminiKeys.length,
          falKeys: c.falKeys.length,
          imageProvider: c.imageProvider,
          imageModel: c.imageModel,
          falModel: c.falModel,
          imageModelLabel: IMAGE_MODEL_LABEL,
          textModel: c.textModel,
          judgeModels: c.judgeModels,
          styleReferenceName: c.styleReferenceName,
          template: PROMPT_TEMPLATE,
          plainTemplate: PLAIN_TEMPLATE,
          remixPrompt: REMIX_PROMPT,
          remixCount: REMIX_COUNT
        })
      }
      return sendJson(res, 404, { error: `No route ${route}` })
    } catch (err) {
      if (res.headersSent) {
        console.error(`API ${req.method} ${url.pathname} failed after the response started:`, err)
        return res.end()
      }
      if (err instanceof BadRequest || err instanceof GameNotFound) return sendJson(res, 400, { error: err.message })
      console.error(`API ${req.method} ${url.pathname} failed:`, err)
      return sendJson(res, 502, { error: err.message })
    }
  }
}
