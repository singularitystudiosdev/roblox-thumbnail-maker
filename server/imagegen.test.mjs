import assert from 'node:assert/strict'
import { test } from 'node:test'
import { falInput, geminiInput } from './imagegen.mjs'
import { ON_ROBLOX_REFERENCE, ON_STYLE_REFERENCE, planLinkedSlots, planSlots } from './run.mjs'

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

test('a run is the template, one novel perspective remix, the search meta, the meta and the plain template', () => {
  const slots = planSlots('Rob Grandmas House')
  assert.deepEqual(slots.map((s) => [s.slot, s.strategy]), [[1, 'template'], [2, 'remix'], [3, 'search'], [4, 'meta'], [5, 'plain']])
  assert.equal(
    slots[0].prompt,
    'Make me a thumbnail for my roblox game "Rob Grandmas House" in the style of my reference image different characters. No text. 16:9 Ratio.'
  )
  assert.equal(slots[1].prompt, 'Make this thumbnail but from a novel perspective. No text.')
  // The search meta, the meta and the plain template send the same words; only the attached reference differs.
  const plain = 'Make me a thumbnail for my game "Rob Grandmas House" in the style of my reference image. No text. 16:9 Ratio.'
  for (const slot of slots.slice(2)) assert.equal(slot.prompt, plain)
  assert.deepEqual(slots.filter((s) => ON_ROBLOX_REFERENCE.has(s.strategy)).map((s) => s.slot), [2, 4])
  assert.deepEqual(slots.filter((s) => ON_STYLE_REFERENCE.has(s.strategy)).map((s) => s.slot), [1, 5])
})

test('a linked run sends the same five prompts, every one with the linked game, the plain-template slots all plain', () => {
  const linked = planLinkedSlots('KAT')
  assert.deepEqual(linked.map((s) => [s.slot, s.strategy]), [[1, 'template'], [2, 'remix'], [3, 'plain'], [4, 'plain'], [5, 'plain']])
  assert.deepEqual(linked.map((s) => s.prompt), planSlots('KAT').map((s) => s.prompt))
})
