import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acceptTitle, cleanTitle, nameRequest } from './namer.mjs'

test('Roblox decoration is stripped from a title, apostrophes kept', () => {
  assert.equal(cleanTitle('[🎃] Rob a Bank💰'), 'Rob a Bank')
  assert.equal(cleanTitle('⛏️Dig to Escape'), 'Dig to Escape')
  assert.equal(cleanTitle('Rob Mr Rich\'s Mansion Obby! (NEW READ DESC)'), 'Rob Mr Rich\'s Mansion Obby')
  assert.equal(cleanTitle('★Make a Cake And Feed the Giant Noob★'), 'Make a Cake And Feed the Giant Noob')
})

test('a model answer is trimmed to a clean single-line title with no dashes', () => {
  assert.equal(acceptTitle('"Break and Steal an Egg from an Animal"'), 'Break and Steal an Egg from an Animal')
  assert.equal(acceptTitle('Title: Grow a Garden and Sell the Harvest.\n\nThis title says...'), 'Grow a Garden and Sell the Harvest')
  assert.equal(acceptTitle('Dig Out — Escape the Prison'), 'Dig Out Escape the Prison')
  assert.equal(acceptTitle('Hide-and-Seek in a Mansion'), 'Hide-and-Seek in a Mansion')
})

test('empty or rambling answers are refused so the fallback title is used', () => {
  assert.equal(acceptTitle(''), null)
  assert.equal(acceptTitle('   \n  '), null)
  assert.equal(acceptTitle('Break eggs to hatch rare animals then steal them and escape the guards to earn cash'), null)
})

test('the request names the game and caps its description', () => {
  const game = { name: 'Break and Steal an Egg', description: 'x'.repeat(5000) }
  const text = nameRequest('Make a thumbnail for my game https://www.roblox.com/games/114326934417838/Break-and-Steal-an-Egg', game)
  assert.ok(text.startsWith("User's request: Make a thumbnail for my game Break and Steal an Egg\n"))
  assert.ok(text.includes('Roblox game they mean: Break and Steal an Egg'))
  assert.ok(text.length < 1700)
  assert.equal(nameRequest('surf giant waves', null), "User's request: surf giant waves\nNo Roblox game matched.")
})
