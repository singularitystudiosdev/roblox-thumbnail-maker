import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPrompt, extractGameName, pickRemixPrompts, PROMPT_TEMPLATE, REMIX_PROMPTS } from './prompt.mjs'

test('the template is the exact text, only GAME_NAME substituted', () => {
  assert.equal(PROMPT_TEMPLATE, 'Make me a thumbnail for my game GAME_NAME in the style of my reference image different characters. No text. 16:9 Ratio.')
  assert.equal(
    buildPrompt('  Steal an Egg '),
    'Make me a thumbnail for my game Steal an Egg in the style of my reference image different characters. No text. 16:9 Ratio.'
  )
  assert.equal(
    buildPrompt('A axe throwing game with a bacon hair in the thumbnail'),
    'Make me a thumbnail for my game A axe throwing game with a bacon hair in the thumbnail in the style of my reference image different characters. No text. 16:9 Ratio.'
  )
})

test('dollar patterns in a name are inserted literally', () => {
  assert.equal(buildPrompt('Get $$ and $&'), PROMPT_TEMPLATE.split('GAME_NAME').join('Get $$ and $&'))
})

test('an empty game name is refused', () => {
  assert.throws(() => buildPrompt('  '))
})

test('the four remix prompts are the exact texts, top down removed', () => {
  assert.deepEqual(REMIX_PROMPTS, [
    'Make this thumbnail but Before-and-After. No text.',
    'Make this thumbnail but from a novel perspective. No text.',
    'Make this thumbnail but High Angle. No text.',
    'Make this thumbnail but Profile Shot. No text.'
  ])
})

test('two different remix prompts are picked, every pair reachable', () => {
  const seen = new Set()
  for (let i = 0; i < 2000; i++) {
    const [a, b] = pickRemixPrompts()
    assert.notEqual(a, b)
    assert.ok(REMIX_PROMPTS.includes(a) && REMIX_PROMPTS.includes(b))
    seen.add(`${a}|${b}`)
  }
  assert.equal(seen.size, 12)
  assert.deepEqual(pickRemixPrompts(() => 0), [REMIX_PROMPTS[0], REMIX_PROMPTS[1]])
  assert.deepEqual(pickRemixPrompts(() => 0.999), [REMIX_PROMPTS[3], REMIX_PROMPTS[2]])
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
})
