import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPrompt, extractGameName, PROMPT_TEMPLATE } from './prompt.mjs'

test('prompt is the fixed text with only the quoted GAME_NAME substituted', () => {
  assert.equal(
    PROMPT_TEMPLATE,
    'Make me a thumbnail for my game "GAME_NAME" in the style of my reference image different characters. No text. 16:9 Ratio.'
  )
  assert.equal(
    buildPrompt('  Bake a Cake '),
    'Make me a thumbnail for my game "Bake a Cake" in the style of my reference image different characters. No text. 16:9 Ratio.'
  )
})

test('a name that already carries quotes is not double-quoted', () => {
  assert.equal(buildPrompt('"Rob a Bank"'), buildPrompt('Rob a Bank'))
  assert.equal(buildPrompt('“Rob a Bank”'), buildPrompt('Rob a Bank'))
})

test('nothing past the game name reaches the prompt', () => {
  assert.equal(buildPrompt('Lava Leap', 'an obby where the floor turns to lava'), buildPrompt('Lava Leap'))
})

test('an empty game name is refused', () => {
  assert.throws(() => buildPrompt('  '))
  assert.throws(() => buildPrompt('""'))
})

test('a request wrapper is stripped down to the name', () => {
  assert.equal(extractGameName('Make me a roblox thumbnail for my game Rob a Bank'), 'Rob a Bank')
  assert.equal(
    buildPrompt(extractGameName('Make me a roblox thumbnail for my game Rob a Bank')),
    'Make me a thumbnail for my game "Rob a Bank" in the style of my reference image different characters. No text. 16:9 Ratio.'
  )
  assert.equal(extractGameName('make a thumbnail for my game called Grow a Garden.'), 'Grow a Garden')
  assert.equal(extractGameName('Can you create a thumbnail for Pet Sim 99'), 'Pet Sim 99')
  assert.equal(extractGameName('My game is called Rob Grandma\'s House'), 'Rob Grandma\'s House')
})

test('anything without a wrapper is used exactly as typed', () => {
  assert.equal(extractGameName('Rob a Bank'), 'Rob a Bank')
  assert.equal(extractGameName('  rob a BANK  '), 'rob a BANK')
  assert.equal(extractGameName('A game where you rob a bank'), 'A game where you rob a bank')
  assert.equal(extractGameName('Natural Disaster Survival!'), 'Natural Disaster Survival!')
})

test('a quoted name or a pasted full prompt yields just the name', () => {
  assert.equal(extractGameName('Make a thumbnail for "Lava Leap" please'), 'Lava Leap')
  assert.equal(
    extractGameName('Make me a thumbnail for my game "Rob a Bank" in the style of my reference image. No text. 16:9 Ratio.'),
    'Rob a Bank'
  )
  assert.equal(
    extractGameName('Make me a thumbnail for my game Rob a Bank in the style of my reference image. No text. 16:9 Ratio.'),
    'Rob a Bank'
  )
})
