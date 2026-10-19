import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickSearchTop, rankSearch } from './searchtop.mjs'

const game = (name, playing, universeId = name) => ({ name, playing, universeId })

// A real Roblox search for "bury a body", 2026-10-19, in Roblox's order.
const BURY = [
  game('Hide the body', 711),
  game('[🎃] Cluck or Hide!🐔', 997),
  game('✨Collect The Body', 1402),
  game('Hide the Friend', 213),
  game('[🎃] Mega Hide and Seek!', 764),
  game('Hide Your Body Parts', 16),
  game('Murder Mystery 2', 266688),
  game('Buried Alive ⚰️😱', 3)
]
const search = async () => BURY
// The model's pick: burying a body and hiding a body are one idea; collecting one is related.
const sameIdea = async (_name, games) => ({
  same: games.filter((g) => /Hide the body|Buried|Body Parts/i.test(g.name)),
  related: games.filter((g) => /Collect The Body/.test(g.name)),
  pickedBy: 'stub model'
})
const withThumb = async (games) => games.map((g) => ({ ...g, thumbnailUrl: `https://tr.rbxcdn.com/${encodeURIComponent(g.name)}` }))

test('bury a body picks Hide the body: the most played same-idea result, not the most played result', async () => {
  let anchorSeen
  const ranking = await rankSearch('bury a body', {
    anchor: '✨Collect The Body',
    search,
    sameIdea: async (name, games, anchor) => {
      anchorSeen = anchor
      return sameIdea(name, games)
    }
  })
  assert.equal(anchorSeen, '✨Collect The Body', 'the model is shown the game the other thumbnails start from')
  assert.deepEqual(ranking.ranked.slice(0, 3).map((g) => g.name), ['Hide the body', 'Hide Your Body Parts', 'Buried Alive ⚰️😱'])
  const picked = await pickSearchTop('bury a body', ranking, { thumbnails: withThumb })
  assert.equal(picked.name, 'Hide the body')
  assert.equal(picked.why, 'The most played of 3 results of a Roblox search for "bury a body" that are the same game idea, with 711 playing.')
})

test('a game the other thumbnails already use is skipped for the next one', async () => {
  const ranking = await rankSearch('bury a body', { search, sameIdea })
  const picked = await pickSearchTop('bury a body', ranking, { exclude: ['Hide the body'], thumbnails: withThumb })
  assert.equal(picked.name, 'Hide Your Body Parts')
  assert.match(picked.why, /Hide the body is already the other thumbnails' reference, so the next one\.$/)
})

test('a game whose thumbnail is not ready is passed over', async () => {
  const ranking = await rankSearch('bury a body', { search, sameIdea })
  const noFirst = async (games) => (await withThumb(games)).filter((g) => g.name !== 'Hide the body')
  assert.equal((await pickSearchTop('bury a body', ranking, { thumbnails: noFirst })).name, 'Hide Your Body Parts')
})

test("with no same-idea result the closest related one wins; with neither, or no model, Roblox's own order", async () => {
  const relatedOnly = await rankSearch('bury a body', { search, sameIdea: async (_n, games) => ({ same: [], related: [games[2]], pickedBy: 'stub' }) })
  const close = await pickSearchTop('bury a body', relatedOnly, { thumbnails: withThumb })
  assert.equal(close.name, '✨Collect The Body')
  assert.match(close.why, /so the closest related one\.$/)
  const none = await rankSearch('bury a body', { search, sameIdea: async () => ({ same: [], related: [], pickedBy: 'stub' }) })
  const picked = await pickSearchTop('bury a body', none, { thumbnails: withThumb })
  assert.equal(picked.name, 'Hide the body')
  assert.match(picked.why, /search's own first result\.$/)
  const failing = await rankSearch('bury a body', {
    search,
    sameIdea: async () => {
      throw new Error('model down')
    }
  })
  assert.equal(failing.pickedBy, 'search order')
  assert.deepEqual(failing.ranked.map((g) => g.name), BURY.map((g) => g.name))
})

test('an empty search gives no pick', async () => {
  const empty = await rankSearch('zzyzx blorp', { search: async () => [], sameIdea })
  assert.equal(await pickSearchTop('zzyzx blorp', empty, { thumbnails: withThumb }), null)
})
