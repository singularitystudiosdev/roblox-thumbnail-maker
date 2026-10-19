import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_IMAGE_MODEL, imageModel, imageModels, labelOfModelId } from './imagemodels.mjs'

test('the switch offers Nano Banana 2, 2.1 and Pro, with Nano Banana 2 the default', () => {
  assert.deepEqual(
    Object.entries(imageModels()).map(([key, m]) => [key, m.label]),
    [
      ['nano-banana-2', 'Nano Banana 2'],
      ['nano-banana-2.1', 'Nano Banana 2.1'],
      ['nano-banana-pro', 'Nano Banana Pro']
    ]
  )
  assert.equal(DEFAULT_IMAGE_MODEL, 'nano-banana-2')
  assert.equal(imageModel().key, 'nano-banana-2')
})

test('each model names its fal.ai edit endpoint; 2.1 has no Gemini API id, so it runs on fal.ai only', () => {
  assert.equal(imageModel('nano-banana-2.1').fal, 'fal-ai/nano-banana-2.1/edit')
  assert.equal(imageModel('nano-banana-2.1').gemini, null)
  assert.equal(imageModel('nano-banana-pro').fal, 'fal-ai/nano-banana-pro/edit')
  assert.equal(imageModel('nano-banana-pro').gemini, 'gemini-3-pro-image')
  assert.equal(imageModel('nano-banana-9'), null)
})

test('an image is labelled by the model that made it, on either route', () => {
  assert.equal(labelOfModelId('fal-ai/nano-banana-pro/edit'), 'Nano Banana Pro')
  assert.equal(labelOfModelId('gemini-3-pro-image'), 'Nano Banana Pro')
  assert.equal(labelOfModelId('fal-ai/nano-banana-2.1/edit'), 'Nano Banana 2.1')
  assert.equal(labelOfModelId('something-else'), null)
})
