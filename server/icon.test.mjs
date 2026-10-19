import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { ICON_ASPECT_RATIO, ICON_SIZE, looksTiled, makeIcon } from './icon.mjs'
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

// A busy 16:9 scene with no repeats: random blocks of colour.
async function scene(width = 1376, height = 768) {
  let seed = 3
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const blocks = await Promise.all(
    Array.from({ length: 40 }, async () => ({
      input: await solid(40 + Math.floor(random() * 300), 40 + Math.floor(random() * 300), `#${Math.floor(random() * 0xffffff).toString(16).padStart(6, '0')}`),
      left: Math.floor(random() * (width - 40)),
      top: Math.floor(random() * (height - 40))
    }))
  )
  return sharp(await solid(width, height, '#202833')).composite(blocks).png().toBuffer()
}

// The scene stacked `copies` times into a square, the strip pattern a bad redraw makes.
async function stacked(copies) {
  const strip = await sharp(await scene()).resize(1024, Math.round(1024 / copies), { fit: 'fill' }).png().toBuffer()
  const height = Math.round(1024 / copies)
  return sharp(await solid(1024, height * copies, '#000000'))
    .composite(Array.from({ length: copies }, (_, i) => ({ input: strip, left: 0, top: i * height })))
    .png()
    .toBuffer()
}

test('a redraw that stacks the thumbnail in strips is seen as tiled; a busy scene and a flat square are not', async () => {
  assert.equal(await looksTiled(await stacked(2)), true)
  assert.equal(await looksTiled(await stacked(3)), true)
  assert.equal(await looksTiled(await scene(1024, 1024)), false)
  assert.equal(await looksTiled(await solid(1024, 1024, '#336699')), false)
})

test('a tiled redraw is dropped and the thumbnail is fitted whole instead', async () => {
  const generate = async () => ({ bytes: await stacked(2), mimeType: 'image/png' })
  const icon = await makeIcon(await thumbnail(), model, { generate })
  assert.equal(icon.redrawn, false)
  assert.deepEqual(await pixel(icon.bytes, 20, 256), [255, 204, 0])
})
