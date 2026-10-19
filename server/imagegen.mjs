// Nano Banana 2.1 (imagemodels.mjs) on fal.ai's hosted endpoint. A model with
// a Gemini API id tries the Gemini API first and falls back to fal.ai when it
// fails (out of quota or credit, or no image back); Nano Banana 2.1 has none,
// so it goes to fal.ai directly. Each call is one prompt plus one reference image,
// nothing else. fal output is 1K, the Gemini route's default size (1376x768);
// at 2K the model drifts from the reference's 3D render into a painterly style.
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
export function falInput(prompt, reference, aspectRatio = ASPECT_RATIO) {
  return {
    prompt,
    num_images: 1,
    aspect_ratio: aspectRatio,
    output_format: 'png',
    resolution: OUTPUT_RESOLUTION,
    image_urls: [`data:${reference.mimeType};base64,${reference.bytes.toString('base64')}`]
  }
}

/** Gemini request body: prompt then reference image, image output only, 16:9 unless told otherwise. */
export function geminiInput(prompt, reference, aspectRatio = ASPECT_RATIO) {
  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, { inlineData: { mimeType: reference.mimeType, data: reference.bytes.toString('base64') } }]
      }
    ],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } }
  }
}

async function viaGemini(prompt, reference, modelId, aspectRatio) {
  const body = await generateContent(modelId, geminiInput(prompt, reference, aspectRatio), 240000)
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

async function viaFal(prompt, reference, endpoint, aspectRatio) {
  const body = await falRun(endpoint, falInput(prompt, reference, aspectRatio))
  const url = body?.images?.[0]?.url
  if (!url) throw new Error('fal returned no image')
  const image = await download(url)
  // sourceUrl lets the judge send fal its own link instead of megabytes of base64.
  return { ...image, sourceUrl: url, provider: 'fal', model: endpoint }
}

/**
 * Sends the exact prompt plus the reference image bytes to `model`
 * (imageModel(): Nano Banana 2.1) at `aspectRatio` (16:9 unless told
 * otherwise); returns the image and which route served it.
 */
export async function generateImage(prompt, reference, model = imageModel(), { aspectRatio = ASPECT_RATIO } = {}) {
  const mode = config().imageProvider
  if (mode === 'fal' || !model.gemini) return viaFal(prompt, reference, model.fal, aspectRatio)
  try {
    return await viaGemini(prompt, reference, model.gemini, aspectRatio)
  } catch (err) {
    if (mode === 'gemini' || config().falKeys.length === 0) throw err
    if (err instanceof ProviderUnavailable) console.warn(`${err.message}. Falling back to fal.ai.`)
    else console.error(`${model.label} via Gemini failed, retrying on fal.ai:`, err)
    return viaFal(prompt, reference, model.fal, aspectRatio)
  }
}

/** A 16:9 thumbnail from the exact prompt and the reference image. */
export const generateThumbnail = (prompt, reference, model) => generateImage(prompt, reference, model)
