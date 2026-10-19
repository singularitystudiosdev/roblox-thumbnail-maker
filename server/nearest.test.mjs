import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keywordQuery, mergeResults, nearness, pickByWords, pickWholeNameMatch, searchPlan } from './nearest.mjs'

const game = (name, playing, universeId = name) => ({ name, playing, universeId })

test('queries keep priority order, duplicates and blanks dropped, five at most', () => {
  assert.deepEqual(searchPlan('Steal an Egg', ['steal an egg', ''], 'steal egg'), ['Steal an Egg', 'steal egg'])
  assert.equal(searchPlan(['a', 'b', 'c', 'd', 'e', 'f']).length, 5)
  assert.equal(keywordQuery('A axe throwing game with a bacon hair in the thumbnail'), 'axe throwing bacon hair')
})

test('results merge rank by rank so every query keeps its best hits', () => {
  const merged = mergeResults([[game('A1', 1), game('A2', 1), game('A3', 1)], [game('B1', 1), game('A1', 1)]], 4)
  assert.deepEqual(merged.map((g) => g.name), ['A1', 'B1', 'A2', 'A3'])
})

test('nearness is the best share of one query found in the title', () => {
  assert.equal(nearness(['axe throwing'], '+1 Axe Throwing'), 1)
  assert.equal(nearness(['axe throwing'], '🪓 +1 Throw Axe'), 1)
  assert.equal(nearness(['axe throwing'], 'Throw A Football!'), 0.5)
  assert.equal(nearness(['axe throwing'], 'Brookhaven 🏡RP'), 0)
})

test('the nearest titles win over popular unrelated ones, then the most played of them', () => {
  // Real "A axe throwing game with a bacon hair in the thumbnail" search hits, 2026-10-18.
  const hits = [
    game('+1 Axe Throwing', 9),
    game('Knife VS Gun DUELS', 5621),
    game('🪓 +1 Throw Axe', 5),
    game('Smash A Bacon', 634),
    game('Brookhaven 🏡RP', 251399),
    game('+1 Hair Escape✂️', 1781)
  ]
  assert.equal(pickByWords(['axe throwing', 'A axe throwing game with a bacon hair in the thumbnail'], hits).name, '+1 Axe Throwing')
  // Real "Steal an Egg" hits: all near, the most played wins.
  const eggs = [game('Steal An Egg', 964694), game('Steal An Egg ROLEPLAY', 2379), game('Break and Steal an Egg', 112012), game('[💀] Steal a Brainrot', 108300)]
  assert.equal(pickByWords(['Steal an Egg'], eggs).name, 'Steal An Egg')
})

test('titles holding the whole name win outright, the most played of them', () => {
  // Real "Steal an Egg" hits, 2026-10-18: a model once picked Break and Steal an Egg here.
  const eggs = [game('Break and Steal an Egg', 112537), game('Steal An Egg', 992611), game('Steal Animal Egg', 5535), game('Fake an Egg', 6762)]
  const whole = pickWholeNameMatch(['Steal an Egg'], eggs)
  assert.equal(whole.game.name, 'Steal An Egg')
  assert.equal(whole.name, 'Steal an Egg')
  // A linked game's title counts as a name too.
  assert.equal(pickWholeNameMatch(['A game like that but with axes', 'Fake an Egg'], eggs).game.name, 'Fake an Egg')
})

test('a description no title holds whole is left to the model', () => {
  const hits = [game('+1 Axe Throwing', 9), game('Smash A Bacon', 634)]
  assert.equal(pickWholeNameMatch(['A axe throwing game with a bacon hair in the thumbnail'], hits), null)
  assert.equal(pickWholeNameMatch(['the game'], hits), null)
})

test('with no shared word the most played of the top five results is taken', () => {
  const hits = [game('One', 5), game('Two', 50), game('Three', 7), game('Four', 1), game('Five', 2), game('Six', 9000)]
  assert.equal(pickByWords(['zzyzx blorp'], hits).name, 'Two')
  assert.equal(pickByWords(['anything'], []), null)
})
