// The one image model every thumbnail and icon uses: Nano Banana 2.1, on
// fal.ai's edit endpoint (google/nano-banana-2.1/edit, about $0.044 a 1K edit
// with one reference against $0.15 for Nano Banana Pro). Google's API lists no
// Nano Banana 2.1 id, so there is no Gemini route unless GEMINI_IMAGE_MODEL
// names one. Checked 2026-10-19 against fal.ai's queue OpenAPI and pricing
// page and Google's model list; FAL_IMAGE_MODEL overrides the endpoint.
import { config } from './env.mjs'

export const IMAGE_MODEL_LABEL = 'Nano Banana 2.1'

/** The image model with its ids on each route; `gemini` is null when it has no Gemini API id. */
export function imageModel() {
  const c = config()
  return { key: 'nano-banana-2.1', label: IMAGE_MODEL_LABEL, gemini: c.imageModel, fal: c.falModel }
}
