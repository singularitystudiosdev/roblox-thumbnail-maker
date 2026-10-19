// A Roblox experience icon from the winning thumbnail: Roblox's 512 by 512
// template (Creator Hub, "Icons", read 2026-10-19; it scales down to sizes
// such as 150 by 150). A square cut of a 16:9 thumbnail loses characters, so
// the run's own image model redraws the thumbnail as a 1:1 square with
// everything kept in frame (ICON_PROMPT), and sharp scales that to 512. When
// the redraw fails, the whole thumbnail is fitted into the square over a
// blurred fill of itself: nothing is cut off either way.
import sharp from 'sharp'
import { generateImage } from './imagegen.mjs'
import { ICON_PROMPT } from './prompt.mjs'

export const ICON_SIZE = 512
export const ICON_ASPECT_RATIO = '1:1'

/** PNG bytes of `bytes` scaled whole into the 512 square, a blurred fill of itself behind any gap. */
export async function squareFit(bytes) {
  const fill = await sharp(bytes).resize(ICON_SIZE, ICON_SIZE, { fit: 'cover' }).blur(24).toBuffer()
  const whole = await sharp(bytes).resize(ICON_SIZE, ICON_SIZE, { fit: 'inside' }).toBuffer()
  return sharp(fill).composite([{ input: whole, gravity: 'center' }]).png().toBuffer()
}

/**
 * The icon for a thumbnail `image` ({ bytes, mimeType, sourceUrl }) drawn by
 * `model` (imagemodels.mjs). `redrawn` says whether the model made the square;
 * `generate` is swappable in tests.
 */
export async function makeIcon(image, model, { generate = generateImage } = {}) {
  let square = null
  try {
    square = await generate(ICON_PROMPT, image, model, { aspectRatio: ICON_ASPECT_RATIO })
  } catch (err) {
    console.error(`The square icon redraw by ${model.label} failed; fitting the thumbnail whole into the square:`, err)
  }
  return { bytes: await squareFit((square ?? image).bytes), mimeType: 'image/png', redrawn: square != null }
}
