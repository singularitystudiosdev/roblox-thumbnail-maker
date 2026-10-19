import assert from 'node:assert/strict'
import { test } from 'node:test'
import { falInput, geminiInput } from './imagegen.mjs'
import { planSlots } from './run.mjs'
import { REMIX_PROMPTS } from './prompt.mjs'

const reference = { mimeType: 'image/png', bytes: Buffer.from('ref') }
const b64 = Buffer.from('ref').toString('base64')

test('fal body: the prompt, 16:9 at 1K, png, one image, the reference as a data URL', () => {
  assert.deepEqual(falInput('p', reference), {
    prompt: 'p',
    num_images: 1,
    aspect_ratio: '16:9',
    output_format: 'png',
    resolution: '1K',
    image_urls: [`data:image/png;base64,${b64}`]
  })
})

test('Gemini body: the prompt then the reference, image output at 16:9', () => {
  assert.deepEqual(geminiInput('p', reference), {
    contents: [{ role: 'user', parts: [{ text: 'p' }, { inlineData: { mimeType: 'image/png', data: b64 } }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } }
  })
})

test('a run is the template plus two different remix prompts', () => {
  const slots = planSlots('Steal an Egg', () => 0.5)
  assert.deepEqual(slots.map((s) => s.strategy), ['template', 'remix', 'remix'])
  assert.equal(slots[0].prompt, 'Make me a thumbnail for my game Steal an Egg in the style of my reference image different characters. No text. 16:9 Ratio.')
  assert.notEqual(slots[1].prompt, slots[2].prompt)
  assert.ok(REMIX_PROMPTS.includes(slots[1].prompt) && REMIX_PROMPTS.includes(slots[2].prompt))
})
