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

// How closely a tiled image matches itself shifted by one tile, as a share of its own contrast. Two stacked copies
// of a thumbnail score under 0.01 and three about 0.18; the 62 icons saved so far score 0.40 (a studded floor) and up.
const TILED_BELOW = 0.25
const TILE_GRID = 128

/**
 * Whether `bytes` repeats itself: shifted down or across by an eighth to a half of its size, it matches itself
 * almost exactly. A redraw that stacked copies of the thumbnail into the square looks like this.
 */
export async function looksTiled(bytes) {
  const size = TILE_GRID
  const data = await sharp(bytes).resize(size, size, { fit: 'fill' }).greyscale().raw().toBuffer()
  const mean = data.reduce((sum, v) => sum + v, 0) / data.length
  const spread = data.reduce((sum, v) => sum + Math.abs(v - mean), 0) / data.length
  if (spread < 4) return false // a nearly flat image has nothing to repeat
  const shiftedDiff = (dx, dy) => {
    let sum = 0
    for (let y = 0; y + dy < size; y++) for (let x = 0; x + dx < size; x++) sum += Math.abs(data[y * size + x] - data[(y + dy) * size + x + dx])
    return sum / ((size - dx) * (size - dy))
  }
  let closest = Infinity
  for (let shift = size / 8; shift <= size / 2; shift++) closest = Math.min(closest, shiftedDiff(0, shift), shiftedDiff(shift, 0))
  return closest / spread < TILED_BELOW
}

/**
 * The icon for a thumbnail `image` ({ bytes, mimeType, sourceUrl }) drawn by
 * `model` (imagemodels.mjs). `redrawn` says whether the model made the square;
 * a redraw that tiled the thumbnail is dropped for the fit. `generate` is
 * swappable in tests.
 */
export async function makeIcon(image, model, { generate = generateImage } = {}) {
  let square = null
  try {
    square = await generate(ICON_PROMPT, image, model, { aspectRatio: ICON_ASPECT_RATIO })
    if (await looksTiled(square.bytes)) {
      console.warn(`The square icon redraw by ${model.label} repeats the thumbnail in strips; fitting the thumbnail whole into the square instead.`)
      square = null
    }
  } catch (err) {
    console.error(`The square icon redraw by ${model.label} failed; fitting the thumbnail whole into the square:`, err)
  }
  return { bytes: await squareFit((square ?? image).bytes), mimeType: 'image/png', redrawn: square != null }
}
