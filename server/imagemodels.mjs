// The one image model every thumbnail and icon uses: Nano Banana Pro, through
// the Gemini API (gemini-3-pro-image) with fal.ai's edit endpoint
// (fal-ai/nano-banana-pro/edit) as the fallback. Both ids were checked
// 2026-10-19 against Google's model list and fal.ai's queue OpenAPI;
// GEMINI_IMAGE_MODEL and FAL_IMAGE_MODEL override them.
import { config } from './env.mjs'

export const IMAGE_MODEL_LABEL = 'Nano Banana Pro'

/** The image model with its ids on each route. */
export function imageModel() {
  const c = config()
  return { key: 'nano-banana-pro', label: IMAGE_MODEL_LABEL, gemini: c.imageModel, fal: c.falModel }
}
