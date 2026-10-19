import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  keywordQuery,
  MIN_PLAYING,
  mergeResults,
  mostPlayedOf,
  nearness,
  pickNearestPopular,
  popularOnly,
  searchPlan,
  sortByWords,
  wholeNameMatches
} from './nearest.mjs'

const game = (name, playing, universeId = name) => ({ name, playing, universeId })

// Real "Bake a Cake" search hits, 2026-10-19: the old pick was Bake a GIANT Cake! with 0 playing.
const CAKES = [
  game('Mukbang Game [Testing]🎃🍝!', 16862),
  game('🎃 Bake or Die 💀', 4549),
  game('[🥞] Paint a Pancake', 3911),
  game('CRAZY CHEFS! 👨‍🍳', 1832),
  game('🍰 Cake Mountain 🥄', 1063),
  game('[UPD🍓] Cake Off!', 260),
  game('Make a Cake!', 25),
  game('Bake Cakes and Prove Mom Wrong 🎂', 2),
  game('Bake a GIANT Cake!', 0)
]

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

test(`games with ${MIN_PLAYING} players or fewer are never a reference`, () => {
  assert.equal(MIN_PLAYING, 300)
  assert.deepEqual(popularOnly([game('Busy', 301), game('Edge', 300), game('Empty', 0)]).map((g) => g.name), ['Busy'])
  assert.ok(!popularOnly(CAKES).some((g) => g.name === 'Bake a GIANT Cake!'))
})

test('titles holding the whole name are the same kind of game', () => {
  const eggs = [game('Break and Steal an Egg', 112537), game('Steal An Egg', 992611), game('Steal Animal Egg', 5535), game('Fake an Egg', 6762)]
  assert.deepEqual(wholeNameMatches(['Steal an Egg'], eggs).map((g) => g.name), ['Break and Steal an Egg', 'Steal An Egg', 'Steal Animal Egg'])
  assert.deepEqual(wholeNameMatches(['A game like that but with axes', 'Fake an Egg'], eggs).map((g) => g.name), ['Fake an Egg'])
  assert.deepEqual(wholeNameMatches(['the game'], eggs), [])
})

test('players decide within a tier; related games only count when no game of the same kind qualifies', () => {
  const same = [game('Close but small', 400), game('Same kind, busy', 9000)]
  assert.equal(mostPlayedOf([['same', same], ['related', [game('Related, huge', 900000)]]]).game.name, 'Same kind, busy')
  assert.deepEqual(mostPlayedOf([['same', []], ['related', [game('R1', 500), game('R2', 700)]]]), { tier: 'related', count: 2, game: game('R2', 700) })
  assert.equal(mostPlayedOf([['same', []], ['related', []]]), null)
})

test('the model sorts the kinds, players pick: Bake a Cake gets Bake or Die, not an empty game', async () => {
  const popular = popularOnly(CAKES)
  // The model's sort: baking games are the same kind, other cooking and food games related.
  const sort = async (_name, games) => ({
    same: games.filter((g) => /Bake or Die|Cake Mountain/.test(g.name)),
    related: games.filter((g) => /CHEFS|Pancake|Mukbang/.test(g.name)),
    sortedBy: 'stub model'
  })
  const picked = await pickNearestPopular('Bake a Cake', ['Bake a Cake'], ['bake cake'], popular, { sort })
  assert.equal(picked.game.name, '🎃 Bake or Die 💀')
  assert.equal(picked.tier, 'same')
  assert.equal(picked.why, 'The most played of 2 games of the same kind with over 300 players.')
  const lone = await pickNearestPopular('Bake a Cake', [], [], popular, { sort: async (_n, games) => ({ same: [games[1]], related: [], sortedBy: 'stub' }) })
  assert.equal(lone.why, 'The only game of the same kind with over 300 players.')
})

test('without a model, shared words sort the games; none qualifying means no Roblox reference', async () => {
  const failing = async () => {
    throw new Error('model down')
  }
  const picked = await pickNearestPopular('Bake a Cake', ['Bake a Cake'], ['bake cake'], popularOnly(CAKES), { sort: failing })
  assert.equal(picked.game.name, '🎃 Bake or Die 💀')
  assert.equal(picked.pickedBy, 'shared words')
  assert.deepEqual(sortByWords(['axe throwing'], [game('Throw A Football!', 4531), game('Brookhaven 🏡RP', 251399)]), {
    same: [game('Throw A Football!', 4531)],
    related: []
  })
  assert.equal(await pickNearestPopular('Zzyzx Blorp', ['Zzyzx Blorp'], ['zzyzx'], [game('Brookhaven 🏡RP', 251399)], { sort: failing }), null)
  assert.equal(await pickNearestPopular('Bake a Cake', ['Bake a Cake'], ['bake cake'], [], { sort: failing }), null)
})
