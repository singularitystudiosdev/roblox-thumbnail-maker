// The image models a run can switch between from the page. Each names its
// Gemini API id (null when Google's API lists none, so fal.ai only) and its
// fal.ai edit endpoint; all three take the same request: the prompt, one
// reference image, 16:9 at 1K. GEMINI_IMAGE_MODEL and FAL_IMAGE_MODEL still set
// Nano Banana 2's ids. Ids checked 2026-10-19 against Google's model list and
// fal.ai's queue OpenAPI for each endpoint.
import { config } from './env.mjs'

export const DEFAULT_IMAGE_MODEL = 'nano-banana-2'

/** Every switchable model by key, in the order the page lists them. */
export function imageModels() {
  const c = config()
  return {
    'nano-banana-2': { label: 'Nano Banana 2', gemini: c.imageModel, fal: c.falModel },
    'nano-banana-2.1': { label: 'Nano Banana 2.1', gemini: null, fal: 'fal-ai/nano-banana-2.1/edit' },
    'nano-banana-pro': { label: 'Nano Banana Pro', gemini: 'gemini-3-pro-image', fal: 'fal-ai/nano-banana-pro/edit' }
  }
}

/** The model for `key` with its key, or null when no model has that key. */
export function imageModel(key = DEFAULT_IMAGE_MODEL) {
  const model = imageModels()[key]
  return model ? { key, ...model } : null
}

/** "Nano Banana Pro" for the Gemini id or fal endpoint that made an image; null when unknown. */
export function labelOfModelId(id) {
  return Object.values(imageModels()).find((m) => m.gemini === id || m.fal === id)?.label ?? null
}
