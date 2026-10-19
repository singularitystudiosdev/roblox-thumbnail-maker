import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { ICON_ASPECT_RATIO, ICON_SIZE, makeIcon } from './icon.mjs'
import { ICON_PROMPT } from './prompt.mjs'

const model = { key: 'nano-banana-2', label: 'Nano Banana 2', gemini: 'g', fal: 'f' }
const solid = async (width, height, color) => sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer()

// A 1376x768 thumbnail, the size Nano Banana returns at 1K, with a yellow subject at each edge.
async function thumbnail() {
  const block = await solid(200, 200, '#ffcc00')
  const bytes = await sharp(await solid(1376, 768, '#202833'))
    .composite([
      { input: block, left: 0, top: 284 },
      { input: block, left: 1176, top: 284 }
    ])
    .png()
    .toBuffer()
  return { bytes, mimeType: 'image/png' }
}

const pixel = async (bytes, x, y) => {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * info.channels
  return [data[at], data[at + 1], data[at + 2]]
}

test('the model redraws the thumbnail as a square with the icon prompt, scaled to 512 by 512', async () => {
  let asked
  const generate = async (prompt, reference, m, options) => {
    asked = { prompt, model: m.label, options, reference }
    return { bytes: await solid(1024, 1024, '#336699'), mimeType: 'image/png' }
  }
  const image = await thumbnail()
  const icon = await makeIcon(image, model, { generate })
  assert.equal(asked.prompt, ICON_PROMPT)
  assert.equal(
    ICON_PROMPT,
    'Resize this image to a 1:1 square. Keep everything in it fully in frame and unchanged: every character and object whole, nothing cut off. Fill the new space by continuing the same scene, never by repeating or tiling any part of the image. No text.'
  )
  assert.equal(asked.model, 'Nano Banana 2')
  assert.deepEqual(asked.options, { aspectRatio: ICON_ASPECT_RATIO })
  assert.equal(asked.reference, image)
  assert.equal(icon.redrawn, true)
  const meta = await sharp(icon.bytes).metadata()
  assert.deepEqual([meta.width, meta.height, meta.format], [ICON_SIZE, ICON_SIZE, 'png'])
})

test('when the redraw fails, the whole thumbnail is fitted into the square: both edge subjects stay in', async () => {
  const icon = await makeIcon(await thumbnail(), model, {
    generate: async () => {
      throw new Error('model down')
    }
  })
  assert.equal(icon.redrawn, false)
  const meta = await sharp(icon.bytes).metadata()
  assert.deepEqual([meta.width, meta.height], [ICON_SIZE, ICON_SIZE])
  // The thumbnail scales to 512x286 in the middle band; its left and right edge subjects are both there.
  const [lr] = await pixel(icon.bytes, 20, 256)
  const [rr] = await pixel(icon.bytes, 491, 256)
  assert.ok(lr > 200 && rr > 200, `edge subjects kept: red ${lr} and ${rr}`)
})
