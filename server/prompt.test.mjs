import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPrompt, heuristicParse, PROMPT_TEMPLATE } from './prompt.mjs'

test('prompt is the fixed text with only GAME_NAME substituted', () => {
  assert.equal(
    PROMPT_TEMPLATE,
    'Make me a thumbnail for my game GAME_NAME in the style of my reference image different characters. No text. 16:9 Ratio.'
  )
  assert.equal(
    buildPrompt('  Rob a Bank '),
    'Make me a thumbnail for my game Rob a Bank in the style of my reference image different characters. No text. 16:9 Ratio.'
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

test('heuristic parse keeps a stated name, else builds one from keywords', () => {
  assert.equal(heuristicParse('a game called Cell Block Breakout about escaping prison').gameName, 'Cell Block Breakout')
  const unnamed = heuristicParse('a game where you rob a bank with your friends')
  assert.equal(unnamed.gameName, null)
  assert.equal(unnamed.suggestedName, 'Rob Bank Friends')
})

test('heuristic parse reads "My game NAME is ..." as the stated name', () => {
  assert.equal(heuristicParse('My game Lava Leap is an obby where the floor turns to lava').gameName, 'Lava Leap')
})

test('heuristic parse falls back to My Game when the prompt has no keywords', () => {
  assert.deepEqual(heuristicParse('make me a game'), { gameName: null, suggestedName: 'My Game' })
})
