import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planAttachedSlots, readAttachedIntent, removesOnlyImageWords } from './attached.mjs'

const answer = (value) => async () => ({ value, model: 'stub model' })

test('a prompt that asks to use the attached image is the reference mode, the game name without the image words', async () => {
  const intent = await readAttachedIntent('Make me a thumbnail for my game Steal an Egg, use this image as a reference', {
    ask: answer({ useAsReference: true, gameText: 'Make me a thumbnail for my game Steal an Egg' })
  })
  assert.deepEqual(intent, { useAsReference: true, gameText: 'Make me a thumbnail for my game Steal an Egg', readBy: 'stub model' })
})

test('a prompt that does not mention the image is not the reference mode', async () => {
  const intent = await readAttachedIntent('Rob a Bank', { ask: answer({ useAsReference: false, gameText: 'Rob a Bank' }) })
  assert.equal(intent.useAsReference, false)
  assert.equal(intent.gameText, 'Rob a Bank')
})

test('a shortened or reworded game text is refused: the game name keeps the whole prompt as typed', async () => {
  const prompt = 'A axe throwing game with a bacon hair in the thumbnail, in the style of my image'
  // "Axe Throwing" drops words that describe the game (the description stays verbatim).
  const shortened = await readAttachedIntent(prompt, { ask: answer({ useAsReference: true, gameText: 'Axe Throwing' }) })
  assert.equal(shortened.useAsReference, true)
  assert.equal(shortened.gameText, prompt)
  const reworded = await readAttachedIntent(prompt, { ask: answer({ useAsReference: true, gameText: 'An axe-tossing game' }) })
  assert.equal(reworded.gameText, prompt)
  // Only the run of words about the image may go, at the end, the start or the middle.
  assert.ok(removesOnlyImageWords('A axe throwing game with a bacon hair in the thumbnail', prompt))
  assert.ok(removesOnlyImageWords('make a thumbnail for Bake a Cake', 'Using this image as reference, make a thumbnail for Bake a Cake'))
  assert.ok(removesOnlyImageWords('Make a thumbnail for Bake a Cake', 'Make a thumbnail like this picture for Bake a Cake'))
  assert.ok(!removesOnlyImageWords('Make a thumbnail for Cake', 'Make a thumbnail like this picture for Bake a Cake'))
  assert.ok(!removesOnlyImageWords('Bake a Cake', 'Bake a Cake with sprinkles'), 'removed words are not about the image')
})

test('without a model, words that name the image or a reference decide', async () => {
  const down = async () => {
    throw new Error('model down')
  }
  assert.equal((await readAttachedIntent('Bake a Cake, use the attached picture', { ask: down })).useAsReference, true)
  assert.equal((await readAttachedIntent('Bake a Cake with this as ref', { ask: down })).useAsReference, true)
  assert.equal((await readAttachedIntent('Bake a Cake', { ask: down })).useAsReference, false)
  // A prompt about someone in the image only makes sense with it.
  assert.equal((await readAttachedIntent('Make him have a gun', { ask: down })).useAsReference, true)
  assert.equal((await readAttachedIntent('Bake a Cake, use the attached picture', { ask: down })).gameText, 'Bake a Cake, use the attached picture')
})

test('the reference mode sends the meta, then the prompt exactly as typed', () => {
  const typed = 'Make a thumbnail for Rob Grandmas House like this image, grandma chasing the robber'
  assert.deepEqual(planAttachedSlots(typed, 'Rob Grandmas House'), [
    { slot: 1, strategy: 'meta', prompt: 'Make me a thumbnail for my game "Rob Grandmas House" in the style of my reference image. No text. 16:9 Ratio.' },
    { slot: 2, strategy: 'typed', prompt: typed }
  ])
})
