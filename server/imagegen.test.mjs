import assert from 'node:assert/strict'
import { test } from 'node:test'
import { falInput } from './imagegen.mjs'

test('fal body matches Nano Banana Studio: 0.5K, auto aspect, png, one image, reference as data URL', () => {
  const body = falInput('p', { mimeType: 'image/png', bytes: Buffer.from('ref') })
  assert.deepEqual(body, {
    prompt: 'p',
    num_images: 1,
    aspect_ratio: 'auto',
    output_format: 'png',
    resolution: '0.5K',
    image_urls: [`data:image/png;base64,${Buffer.from('ref').toString('base64')}`]
  })
})
