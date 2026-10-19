// Nano Banana 2, two routes to the same model: the Gemini API directly, or
// fal.ai's hosted endpoint when every Gemini key is out of quota or credit.
// Output settings are fixed to what Nano Banana Studio (localhost:8890) sends:
// at 2K the model drifts from the reference's 3D render into a painterly style.
import { config } from './env.mjs'
import { falRun } from './fal.mjs'
import { generateContent, ProviderUnavailable } from './gemini.mjs'

export const OUTPUT_RESOLUTION = '0.5K'

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status} for ${new URL(url).hostname}`)
  return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get('content-type')?.split(';')[0] ?? 'image/png' }
}

/** fal request body, field for field the one Nano Banana Studio sends. */
export function falInput(prompt, reference) {
  return {
    prompt,
    num_images: 1,
    aspect_ratio: 'auto',
    output_format: 'png',
    resolution: OUTPUT_RESOLUTION,
    image_urls: [`data:${reference.mimeType};base64,${reference.bytes.toString('base64')}`]
  }
}

// Like Nano Banana Studio's Google call: prompt then image, no size or aspect config.
async function viaGemini(prompt, reference) {
  const body = await generateContent(
    config().imageModel,
    {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }, { inlineData: { mimeType: reference.mimeType, data: reference.bytes.toString('base64') } }]
        }
      ],
      generationConfig: { responseModalities: ['IMAGE'] }
    },
    240000
  )
  const parts = body?.candidates?.[0]?.content?.parts ?? []
  const image = parts.filter((p) => p.inlineData && !p.thought).at(-1)
  if (!image) throw new Error(`${config().imageModel} returned no image (finish: ${body?.candidates?.[0]?.finishReason ?? 'unknown'})`)
  return {
    bytes: Buffer.from(image.inlineData.data, 'base64'),
    mimeType: image.inlineData.mimeType,
    provider: 'gemini',
    model: config().imageModel
  }
}

async function viaFal(prompt, reference) {
  const body = await falRun(config().falModel, falInput(prompt, reference))
  const url = body?.images?.[0]?.url
  if (!url) throw new Error('fal returned no image')
  const image = await download(url)
  return { ...image, provider: 'fal', model: config().falModel }
}

/** Sends the exact prompt plus the reference image bytes; returns the image and which route served it. */
export async function generateThumbnail(prompt, reference) {
  const mode = config().imageProvider
  if (mode === 'fal') return viaFal(prompt, reference)
  try {
    return await viaGemini(prompt, reference)
  } catch (err) {
    if (mode === 'gemini' || !(err instanceof ProviderUnavailable)) throw err
    console.warn(`${err.message}. Falling back to fal.ai.`)
    return viaFal(prompt, reference)
  }
}
