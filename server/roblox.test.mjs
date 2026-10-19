import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  cleanTitle,
  downloadThumbnail,
  findGameLink,
  gameFromPlace,
  GameNotFound,
  gamesFromSearch,
  isAllowedReferenceUrl,
  nameTokens,
  sameWord,
  searchGames,
  titleFromSlug,
  withThumbnails
} from './roblox.mjs'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Answers each request with the JSON the matching handler returns, and records the URLs asked for. */
function stubFetch(handler) {
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    const { status = 200, body } = handler(String(url))
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return urls
}

test('omni-search payload flattens to games, sponsored slots dropped', () => {
  const games = gamesFromSearch({
    searchResults: [
      { contentGroupType: 'Game', contents: [{ universeId: 1, rootPlaceId: 10, name: 'Dig to Escape', playerCount: 5, canonicalUrlPath: '/games/10/Dig-to-Escape' }] },
      { contentGroupType: 'Game', contents: [{ universeId: 2, rootPlaceId: 20, name: 'Ad', isSponsored: true }] },
      { contentGroupType: 'Topic', contents: [{ universeId: 3 }] }
    ]
  })
  assert.deepEqual(games, [{ universeId: 1, placeId: 10, name: 'Dig to Escape', playing: 5, url: 'https://www.roblox.com/games/10/Dig-to-Escape' }])
})

test('name words drop filler, emoji and plurals', () => {
  assert.deepEqual(nameTokens('[🎃] Rob a Bank💰'), ['rob', 'bank'])
  assert.deepEqual(nameTokens('A axe throwing game with a bacon hair in the thumbnail'), ['axe', 'throwing', 'bacon', 'hair'])
})

test('word stems count as near, words merely containing the name do not', () => {
  assert.ok(sameWord('bake', 'bakery'))
  assert.ok(sameWord('throw', 'throwing'))
  assert.ok(!sameWord('cake', 'pancake'))
  assert.ok(!sameWord('axe', 'axes2'))
})

test('a roblox.com game link yields its place id, slug and exact text', () => {
  assert.deepEqual(findGameLink('Make a thumbnail for https://www.roblox.com/games/107778070777162/Steal-An-Egg please'), {
    placeId: '107778070777162',
    slug: 'Steal-An-Egg',
    raw: 'https://www.roblox.com/games/107778070777162/Steal-An-Egg'
  })
  assert.equal(findGameLink('roblox.com/games/920587237').slug, null)
  assert.equal(findGameLink('https://www.roblox.com/de/games/606849621/Jailbreak').placeId, '606849621')
  assert.equal(findGameLink('https://www.roblox.com/games/1/unnamed').slug, null)
  assert.deepEqual(findGameLink('https://www.roblox.com/games/start?placeId=2753915549'), {
    placeId: '2753915549',
    slug: null,
    raw: 'https://www.roblox.com/games/start?placeId=2753915549'
  })
})

test('text without a roblox.com game link has none', () => {
  assert.equal(findGameLink('Rob a Bank'), null)
  assert.equal(findGameLink('https://example.com/games/123/Fake'), null)
})

test('a slug reads as a title: minor words lowercase, caps kept', () => {
  assert.equal(titleFromSlug('Steal-An-Egg'), 'Steal an Egg')
  assert.equal(titleFromSlug('steal-an-egg'), 'Steal an Egg')
  assert.equal(titleFromSlug('Break-and-Steal-an-Egg'), 'Break and Steal an Egg')
  assert.equal(titleFromSlug('A-Dusty-Trip'), 'A Dusty Trip')
  assert.equal(titleFromSlug('DOORS'), 'DOORS')
  assert.equal(titleFromSlug('Pet-Simulator-99'), 'Pet Simulator 99')
  // A malformed escape stays as typed.
  assert.equal(titleFromSlug('bad%E0'), 'bad%E0')
})

test('Roblox title decoration is removed', () => {
  assert.equal(cleanTitle('[🥚] Steal An Egg!'), 'Steal An Egg')
  assert.equal(cleanTitle('Grow a Garden 🌶️ (READ DESC)'), 'Grow a Garden')
})

test('search sends the query encoded and returns game rows', async () => {
  const urls = stubFetch(() => ({
    body: { searchResults: [{ contentGroupType: 'Game', contents: [{ universeId: 7, rootPlaceId: 70, name: 'Axe Throwing', playerCount: 9 }] }] }
  }))
  const games = await searchGames('axe throwing & more')
  assert.match(urls[0], /searchQuery=axe%20throwing%20%26%20more&/)
  assert.deepEqual(games.map((g) => [g.universeId, g.url]), [[7, 'https://www.roblox.com/games/70']])
})

test('games whose thumbnail is not ready are dropped', async () => {
  const urls = stubFetch(() => ({
    body: {
      data: [
        { universeId: 1, thumbnails: [{ state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/one' }] },
        { universeId: 2, thumbnails: [{ state: 'Pending', imageUrl: null }] }
      ]
    }
  }))
  const games = await withThumbnails([{ universeId: 1, name: 'One' }, { universeId: 2, name: 'Two' }])
  assert.match(urls[0], /universeIds=1,2&.*size=768x432/)
  assert.deepEqual(games, [{ universeId: 1, name: 'One', thumbnailUrl: 'https://tr.rbxcdn.com/one' }])
  assert.deepEqual(await withThumbnails([]), [])
})

test('a link to a place that is not a game is the user input at fault', async () => {
  stubFetch(() => ({ status: 404, body: { errors: [] } }))
  await assert.rejects(gameFromPlace('123'), GameNotFound)
})

test('only https Roblox CDN references are allowed', async () => {
  assert.ok(isAllowedReferenceUrl('https://tr.rbxcdn.com/180DAY-abc/768/432/Image/Png/noFilter'))
  assert.ok(!isAllowedReferenceUrl('http://tr.rbxcdn.com/x'))
  assert.ok(!isAllowedReferenceUrl('https://rbxcdn.com.evil.test/x'))
  assert.ok(!isAllowedReferenceUrl('http://169.254.169.254/latest'))
  assert.ok(!isAllowedReferenceUrl(undefined))
  await assert.rejects(downloadThumbnail('http://169.254.169.254/latest'), /Roblox CDN/)
})
