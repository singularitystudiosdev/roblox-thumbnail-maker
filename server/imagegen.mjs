// The run's Nano Banana model (imagemodels.mjs: 2 by default, 2.1 or Pro), two
// routes to the same model: the Gemini API directly, or fal.ai's hosted
// endpoint when Gemini fails (out of quota or credit, or no image back), or
// fal.ai alone when Google's API has no id for the model. Each call is one
// prompt plus one reference image, nothing else. fal output is 1K, the Gemini
// route's default size (1376x768); at 2K the model drifts from the
// reference's 3D render into a painterly style.
import { config } from './env.mjs'
import { falRun } from './fal.mjs'
import { generateContent, ProviderUnavailable } from './gemini.mjs'
import { imageModel } from './imagemodels.mjs'
import { imageMimeType } from './mime.mjs'

export const OUTPUT_RESOLUTION = '1K'
// Roblox thumbnails are 16:9; both routes are asked for it outright.
export const ASPECT_RATIO = '16:9'

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status} for ${new URL(url).hostname}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  return { bytes, mimeType: imageMimeType(bytes, res.headers.get('content-type')) }
}

/** fal request body: the prompt, one image, the reference as a data URL. */
export function falInput(prompt, reference) {
  return {
    prompt,
    num_images: 1,
    aspect_ratio: ASPECT_RATIO,
    output_format: 'png',
    resolution: OUTPUT_RESOLUTION,
    image_urls: [`data:${reference.mimeType};base64,${reference.bytes.toString('base64')}`]
  }
}

/** Gemini request body: prompt then reference image, image output only, 16:9. */
export function geminiInput(prompt, reference) {
  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, { inlineData: { mimeType: reference.mimeType, data: reference.bytes.toString('base64') } }]
      }
    ],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ASPECT_RATIO } }
  }
}

async function viaGemini(prompt, reference, modelId) {
  const body = await generateContent(modelId, geminiInput(prompt, reference), 240000)
  const parts = body?.candidates?.[0]?.content?.parts ?? []
  const image = parts.filter((p) => p.inlineData && !p.thought).at(-1)
  if (!image) throw new Error(`${modelId} returned no image (finish: ${body?.candidates?.[0]?.finishReason ?? 'unknown'})`)
  return {
    bytes: Buffer.from(image.inlineData.data, 'base64'),
    mimeType: image.inlineData.mimeType,
    provider: 'gemini',
    model: modelId
  }
}

async function viaFal(prompt, reference, endpoint) {
  const body = await falRun(endpoint, falInput(prompt, reference))
  const url = body?.images?.[0]?.url
  if (!url) throw new Error('fal returned no image')
  const image = await download(url)
  // sourceUrl lets the judge send fal its own link instead of megabytes of base64.
  return { ...image, sourceUrl: url, provider: 'fal', model: endpoint }
}

/**
 * Sends the exact prompt plus the reference image bytes to `model` (from
 * imageModel(); Nano Banana 2 by default); returns the image and which route served it.
 */
export async function generateThumbnail(prompt, reference, model = imageModel()) {
  const mode = config().imageProvider
  if (!model.gemini) {
    if (mode === 'gemini') throw new Error(`${model.label} is on fal.ai only, and IMAGE_PROVIDER is set to gemini.`)
    return viaFal(prompt, reference, model.fal)
  }
  if (mode === 'fal') return viaFal(prompt, reference, model.fal)
  try {
    return await viaGemini(prompt, reference, model.gemini)
  } catch (err) {
    if (mode === 'gemini' || config().falKeys.length === 0) throw err
    if (err instanceof ProviderUnavailable) console.warn(`${err.message}. Falling back to fal.ai.`)
    else console.error(`${model.label} via Gemini failed, retrying on fal.ai:`, err)
    return viaFal(prompt, reference, model.fal)
  }
}
