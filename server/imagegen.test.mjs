import assert from 'node:assert/strict'
import { test } from 'node:test'
import { falInput, geminiInput, IMAGE_TIMEOUT_MS, requestFalImage } from './imagegen.mjs'
import { NO_ROBLOX_FALLBACK, ON_ROBLOX_REFERENCE, planSlots, slotsForReference } from './run.mjs'

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

test('every run is the meta, then the novel perspective remix, both on the Roblox reference, word for word', () => {
  const slots = planSlots('Rob Grandmas House')
  assert.deepEqual(slots, [
    { slot: 1, strategy: 'meta', prompt: 'Make me a thumbnail for my game "Rob Grandmas House" in the style of my reference image. No text. 16:9 Ratio.' },
    { slot: 2, strategy: 'remix', prompt: 'Make this thumbnail but from a novel perspective. No text.' }
  ])
  assert.ok(slots.every((s) => ON_ROBLOX_REFERENCE.has(s.strategy)))
  // A linked run draws the same two, on the linked game's own thumbnail.
  assert.deepEqual(planSlots('Steal an Egg').map((s) => s.strategy), ['meta', 'remix'])
})

test('with no Roblox game to start from, the remix gives way to the exact template on the style image; the meta stays', () => {
  const slots = planSlots('Zzyzx Blorp')
  assert.equal(slotsForReference(slots, 'Zzyzx Blorp', true), slots)
  const fallback = slotsForReference(slots, 'Zzyzx Blorp', false)
  assert.deepEqual(fallback[0], slots[0])
  assert.deepEqual(fallback[1], {
    slot: 2,
    strategy: 'template',
    prompt: 'Make me a thumbnail for my roblox game "Zzyzx Blorp" in the style of my reference image. No text. 16:9 Ratio.',
    fallback: NO_ROBLOX_FALLBACK
  })
  // The creator's typed prompt with their own image never changes.
  const typed = [slots[0], { slot: 2, strategy: 'typed', prompt: 'make him have a gun' }]
  assert.deepEqual(slotsForReference(typed, 'Zzyzx Blorp', false), typed)
})

test('an image request stuck past its timeout is asked for once more; any other failure is not', async () => {
  const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  const calls = []
  const stuckOnce = async (endpoint, input, timeoutMs) => {
    calls.push(timeoutMs)
    if (calls.length === 1) throw timeout()
    return { images: [{ url: 'https://fal.media/x.png' }] }
  }
  assert.deepEqual(await requestFalImage('google/nano-banana-2.1/edit', {}, { run: stuckOnce }), { images: [{ url: 'https://fal.media/x.png' }] })
  assert.deepEqual(calls, [IMAGE_TIMEOUT_MS, IMAGE_TIMEOUT_MS])
  // Two timeouts in a row fail the slot; a refusal (credit, content) fails at once without a second request.
  await assert.rejects(requestFalImage('e', {}, { run: async () => { throw timeout() } }), { name: 'TimeoutError' })
  let refusals = 0
  const refused = async () => {
    refusals++
    throw new Error('fal e: HTTP 403 User is locked. Reason: TOP_UP.')
  }
  await assert.rejects(requestFalImage('e', {}, { run: refused }), /TOP_UP/)
  assert.equal(refusals, 1)
})
