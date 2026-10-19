import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isPopular,
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

const game = (name, playing, universeId = name, visits) => ({ name, playing, universeId, ...(visits == null ? {} : { visits }) })

// Real "Domino game" search hits, 2026-10-19 05:40Z: every domino game sat under 300 playing.
const DOMINOES = [
  game('[UPD] Paint to Get Rich 🎨', 10985, 'paint', 44_700_000),
  game('Chaos Jenga', 2900, 'jenga', 124_500_000),
  game('Mansion Tycoon 🌴🏠', 2565, 'mansion', 662_100_000),
  game('Domino Engine', 252, 'engine', 46_200_000),
  game('Domino Empire', 96, 'empire', 6_900_000),
  game('Mega Domino Playground🔥', 94, 'mega', 52_200_000),
  game('Domino Playground', 7, 'playground', 111_000_000)
]

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

test(`popular is over ${MIN_PLAYING} playing, or an established game with 100 playing in a quiet hour`, () => {
  assert.equal(MIN_PLAYING, 300)
  assert.deepEqual(popularOnly([game('Busy', 301), game('Edge', 300), game('Empty', 0)]).map((g) => g.name), ['Busy'])
  assert.ok(!popularOnly(CAKES).some((g) => g.name === 'Bake a GIANT Cake!'))
  assert.ok(isPopular(game('Domino Engine', 252, 'engine', 46_200_000)))
  assert.ok(!isPopular(game('Mega Domino Playground🔥', 94, 'mega', 52_200_000)), 'too few playing even for an established game')
  assert.ok(!isPopular(game('Small and new', 250, 'small', 900_000)), 'quiet and not established')
  assert.ok(!isPopular(game('No visit count', 250)))
})

test('titles holding the whole name are the same kind of game', () => {
  const eggs = [game('Break and Steal an Egg', 112537), game('Steal An Egg', 992611), game('Steal Animal Egg', 5535), game('Fake an Egg', 6762)]
  assert.deepEqual(wholeNameMatches(['Steal an Egg'], eggs).map((g) => g.name), ['Break and Steal an Egg', 'Steal An Egg', 'Steal Animal Egg'])
  assert.deepEqual(wholeNameMatches(['A game like that but with axes', 'Fake an Egg'], eggs).map((g) => g.name), ['Fake an Egg'])
  assert.deepEqual(wholeNameMatches(['the game'], eggs), [])
})

test('players decide within the same kind; a related stand-in is the closest popular one, not the biggest', async () => {
  assert.deepEqual(mostPlayedOf([game('Close but small', 400), game('Same kind, busy', 9000)]), { count: 2, game: game('Same kind, busy', 9000) })
  assert.equal(mostPlayedOf([]), null)
  // Real late-night axe hits, 2026-10-19: the only axe game was quiet, and the most played related game was a hangout game.
  const axes = [game('+1 Axe Throwing', 18), game('Throw a KNIFE!', 400), game('Brookhaven 🏡RP', 206642)]
  const sort = async (_n, games) => ({ same: [games[0]], related: [games[1], games[2]], sortedBy: 'stub model' })
  const picked = await pickNearestPopular('axe throwing', ['axe throwing'], ['axe throwing'], axes, { sort })
  assert.equal(picked.game.name, 'Throw a KNIFE!')
  assert.equal(picked.tier, 'related')
  assert.equal(picked.why, 'No popular game of the same kind; the closest popular game in a related genre, with over 300 playing.')
  // A quiet game of the same kind is never the pick, and no related game means no Roblox reference.
  const none = await pickNearestPopular('axe throwing', ['axe throwing'], ['axe throwing'], axes, { sort: async () => ({ same: [], related: [], sortedBy: 'stub' }) })
  assert.equal(none, null)
})

test('the model sorts the kinds, players pick: Bake a Cake gets Bake or Die, not an empty game', async () => {
  // The model's sort: baking games are the same kind, other cooking and food games related.
  const sort = async (_name, games) => ({
    same: games.filter((g) => /Bake or Die|Cake Mountain|GIANT Cake/.test(g.name)),
    related: games.filter((g) => /CHEFS|Pancake|Mukbang/.test(g.name)),
    sortedBy: 'stub model'
  })
  const picked = await pickNearestPopular('Bake a Cake', ['Bake a Cake'], ['bake cake'], CAKES, { sort })
  assert.equal(picked.game.name, '🎃 Bake or Die 💀')
  assert.equal(picked.tier, 'same')
  assert.equal(picked.why, 'The most played of 2 popular games of the same kind, with over 300 playing.')
  const lone = await pickNearestPopular('Bake a Cake', [], [], CAKES, { sort: async (_n, games) => ({ same: [games[1]], related: [], sortedBy: 'stub' }) })
  assert.equal(lone.why, 'The only popular game of the same kind, with over 300 playing.')
})

test('Domino game gets Domino Engine: the sort sees the quiet domino games, and an established one counts', async () => {
  let shown = []
  // The model's sort, given every candidate: dominoes are the same kind, Jenga only related.
  const sort = async (_name, games) => {
    shown = games.map((g) => g.name)
    return { same: games.filter((g) => /Domino/.test(g.name)), related: games.filter((g) => /Jenga/.test(g.name)), sortedBy: 'stub model' }
  }
  const picked = await pickNearestPopular('Domino game', ['Domino game'], ['domino'], DOMINOES, { sort })
  assert.ok(shown.includes('Domino Playground'), 'the sort is shown games under the floor too')
  assert.equal(picked.game.name, 'Domino Engine')
  // Its title holds the whole name ("game" is filler), so it is named for it.
  assert.equal(picked.tier, 'named')
  assert.equal(picked.why, 'The only popular game named for yours, with 252 playing now and 46.2M visits.')
  // With no domino game popular at all, a related game is the fallback, never the quiet domino games.
  const quiet = DOMINOES.filter((g) => g.name !== 'Domino Engine')
  assert.equal((await pickNearestPopular('Domino game', ['Domino game'], ['domino'], quiet, { sort })).game.name, 'Chaos Jenga')
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

test('a game named for the creator\'s wins over a bigger game of the same kind: Ragdoll Soccer gets Ragdoll Football', async () => {
  // Real "Ragdoll Soccer" candidates, 2026-10-19: the most played of the same kind was Illegal Soccer.
  const soccer = [game('[UPDATE!] Illegal Soccer', 39032), game('Realistic Street Soccer', 13746), game('Ragdoll Engine ⚙️', 10412), game('Ragdoll Football', 559, 'ragdoll-football', 3_615_153)]
  const sort = async (_name, games) => ({
    named: games.filter((g) => g.name === 'Ragdoll Football'),
    same: games.filter((g) => /Soccer|Football/.test(g.name)),
    related: games.filter((g) => /Engine/.test(g.name)),
    sortedBy: 'stub model'
  })
  const picked = await pickNearestPopular('Ragdoll Soccer', ['Ragdoll Soccer'], ['ragdoll soccer'], soccer, { sort })
  assert.equal(picked.game.name, 'Ragdoll Football')
  assert.equal(picked.tier, 'named')
  assert.equal(picked.why, 'The only popular game named for yours, with over 300 playing.')
  // A named game nobody plays never wins: the same kind decides, most played first.
  const quiet = soccer.map((g) => (g.name === 'Ragdoll Football' ? { ...g, playing: 20, visits: 9000 } : g))
  const fallback = await pickNearestPopular('Ragdoll Soccer', ['Ragdoll Soccer'], ['ragdoll soccer'], quiet, { sort })
  assert.equal(fallback.game.name, '[UPDATE!] Illegal Soccer')
  assert.equal(fallback.tier, 'same')
  // A model reply with no named list still sorts by kind.
  const older = await pickNearestPopular('Ragdoll Soccer', ['Ragdoll Soccer'], ['ragdoll soccer'], soccer, { sort: async (n, games) => ({ ...(await sort(n, games)), named: undefined }) })
  assert.equal(older.game.name, '[UPDATE!] Illegal Soccer')
})
