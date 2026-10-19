import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPrompt, extractGameName, PLAIN_TEMPLATE, PROMPT_TEMPLATE, REMIX_COUNT, REMIX_PROMPT } from './prompt.mjs'

test('the template is the exact text, only GAME_NAME substituted', () => {
  assert.equal(PROMPT_TEMPLATE, 'Make me a thumbnail for my roblox game "GAME_NAME" in the style of my reference image. No text. 16:9 Ratio.')
  assert.equal(buildPrompt('  Bake a Cake '), 'Make me a thumbnail for my roblox game "Bake a Cake" in the style of my reference image. No text. 16:9 Ratio.')
  assert.equal(
    buildPrompt('A axe throwing game with a bacon hair in the thumbnail'),
    'Make me a thumbnail for my roblox game "A axe throwing game with a bacon hair in the thumbnail" in the style of my reference image. No text. 16:9 Ratio.'
  )
  assert.ok(!/different characters/i.test(buildPrompt('Steal an Egg')), 'the template never asks for different characters')
})

test('the plain template is the exact text, only GAME_NAME substituted', () => {
  assert.equal(PLAIN_TEMPLATE, 'Make me a thumbnail for my game "GAME_NAME" in the style of my reference image. No text. 16:9 Ratio.')
  assert.equal(
    buildPrompt('"Break and Steal a Egg"', PLAIN_TEMPLATE),
    'Make me a thumbnail for my game "Break and Steal a Egg" in the style of my reference image. No text. 16:9 Ratio.'
  )
  assert.equal(extractGameName(buildPrompt('Rob a Bank', PLAIN_TEMPLATE)), 'Rob a Bank')
})

test('a name typed in quotes is not quoted twice', () => {
  assert.equal(buildPrompt('"Bake a Cake"'), buildPrompt('Bake a Cake'))
  assert.equal(buildPrompt('“Bake a Cake”'), buildPrompt('Bake a Cake'))
})

test('dollar patterns in a name are inserted literally', () => {
  assert.equal(buildPrompt('Get $$ and $&'), PROMPT_TEMPLATE.split('GAME_NAME').join('Get $$ and $&'))
})

test('an empty game name is refused', () => {
  assert.throws(() => buildPrompt('  '))
})

test('the remix prompt is novel perspective, word for word; every other angle is gone', () => {
  assert.equal(REMIX_PROMPT, 'Make this thumbnail but from a novel perspective. No text.')
})

test('a run draws the novel perspective remix three times', () => {
  assert.equal(REMIX_COUNT, 3)
})

test('a description is the game name, word for word', () => {
  assert.equal(
    extractGameName('A axe throwing game with a bacon hair in the thumbnail'),
    'A axe throwing game with a bacon hair in the thumbnail'
  )
  assert.equal(extractGameName('A game where you rob a bank'), 'A game where you rob a bank')
  assert.equal(extractGameName('  rob a BANK  '), 'rob a BANK')
  assert.equal(extractGameName('Natural Disaster Survival!'), 'Natural Disaster Survival!')
})

test('a request wrapper is stripped down to the name', () => {
  assert.equal(extractGameName('Make me a roblox thumbnail for my game Rob a Bank'), 'Rob a Bank')
  assert.equal(extractGameName('make a thumbnail for my game called Grow a Garden.'), 'Grow a Garden')
  assert.equal(extractGameName('Can you create a thumbnail for Pet Sim 99'), 'Pet Sim 99')
  assert.equal(extractGameName("My game is called Rob Grandma's House"), "Rob Grandma's House")
  assert.equal(
    extractGameName('Make me a thumbnail for A axe throwing game with a bacon hair in the thumbnail'),
    'A axe throwing game with a bacon hair in the thumbnail'
  )
})

test('a quoted name or a pasted full prompt yields just the name', () => {
  assert.equal(extractGameName('Make a thumbnail for "Lava Leap" please'), 'Lava Leap')
  assert.equal(extractGameName(buildPrompt('Steal an Egg')), 'Steal an Egg')
  assert.equal(extractGameName('"Bake a Cake"'), 'Bake a Cake')
  assert.equal(extractGameName('my game is called "Pet Rock"'), 'Pet Rock')
  assert.equal(extractGameName('Steal an Egg in the style of my reference image'), 'Steal an Egg')
})

test('style words, "no text" and quotes inside a description stay part of it', () => {
  // Each of these was cut short or reduced to its quote before the fix.
  for (const description of [
    'A farming game based on Stardew Valley',
    'A tycoon game in the style of Pixar with robots',
    'An obby with no text on the screen',
    'A game with a "Pet Rock" and bacon hair',
    '"Pet Rock" with a bacon hair'
  ]) {
    assert.equal(extractGameName(description), description)
  }
})
