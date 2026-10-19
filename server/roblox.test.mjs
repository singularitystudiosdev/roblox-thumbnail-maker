import assert from 'node:assert/strict'
import { test } from 'node:test'
import { closestTitleMatch, gamesFromSearch, isAllowedReferenceUrl, nameTokens, parseGameUrl, pickReference } from './roblox.mjs'

const game = (name, playing) => ({ name, playing })

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
  assert.deepEqual(nameTokens('Make a Cake And Feed the Giant Noobs!'), ['make', 'cake', 'feed', 'giant', 'noob'])
})

test('an unrelated high-CCU result is never picked over a near one', () => {
  // Real "Grow a Garden" results, 2026-10-18: Steal An Egg sits 4th with 923k players.
  const picked = pickReference('Grow a Garden', [
    game('[🎃] Grow a Garden 🌶️', 19149),
    game('[UPD] Grow a Tornado (Custom Interceptors)', 873),
    game('Grow a Garden 2', 1777),
    game('Steal An Egg', 923531),
    game('[💀] Steal a Brainrot', 122286)
  ])
  assert.equal(picked.game.name, '[🎃] Grow a Garden 🌶️')
  assert.equal(picked.nearCount, 3)
})

test('word stems count as near, words merely containing the name do not', () => {
  const picked = pickReference('Bake a Cake', [
    game('Make a Cake!', 41),
    game('Bakers Valley', 57),
    game('[🥞] Paint a Pancake', 5127),
    game('🎃 Bake or Die 💀', 5324),
    game('Bakery Simulator', 13)
  ])
  assert.equal(picked.game.name, '🎃 Bake or Die 💀')
  assert.equal(picked.nearCount, 4)
})

test('with no near result there is no Roblox reference, however popular the hits', () => {
  // Real search for a nonsense name, 2026-10-18: generic top games come back.
  assert.equal(pickReference('Zzyzxqv Blorp', [game('Brookhaven 🏡RP', 295958), game('Steal a Brainrot', 122286)]), null)
  assert.equal(pickReference('Rob a Bank', []), null)
  assert.equal(pickReference('the game', [game('The Game', 5)]), null)
})

test('a CCU tie keeps Roblox relevance order', () => {
  assert.equal(pickReference('Rob a Bank', [game('Rob It', 50), game('Bank Heist', 50)]).game.name, 'Rob It')
})

test('a roblox.com game link yields its place id, other text does not', () => {
  assert.equal(parseGameUrl('Make a thumbnail for my game https://www.roblox.com/games/114326934417838/Break-and-Steal-an-Egg'), '114326934417838')
  assert.equal(parseGameUrl('roblox.com/games/920587237'), '920587237')
  assert.equal(parseGameUrl('https://www.roblox.com/de/games/606849621/Jailbreak'), '606849621')
  assert.equal(parseGameUrl('https://www.roblox.com/games/start?placeId=2753915549'), '2753915549')
  assert.equal(parseGameUrl('Rob a Bank'), null)
  assert.equal(parseGameUrl('https://example.com/games/123'), null)
})

test('the game the user means is the closest title, not the most played', () => {
  // Real "Break and Steal an Egg" search results, 2026-10-18.
  const results = [game('Break and Steal an Egg', 104045), game('Steal An Egg', 913663), game('[🧟EVENT] Break a Brainrot Egg!', 5022)]
  assert.equal(closestTitleMatch('Break and Steal an Egg', results).name, 'Break and Steal an Egg')
  assert.equal(closestTitleMatch('Rob a Bank', [game('Rob A Jewellery Store Obby', 112), game('[🎃] Rob a Bank💰', 7)]).name, '[🎃] Rob a Bank💰')
})

test('a title sharing too few words is a different game, so none is matched', () => {
  assert.equal(closestTitleMatch('Lava Leap', [game('The Floor Is LAVA!🔥', 2365)]), null)
  assert.equal(closestTitleMatch('surf giant waves with sharks', [game('SharkBite 2', 5000), game('Surf', 10)]), null)
  assert.equal(closestTitleMatch('Rob a Bank', []), null)
})

test('only https Roblox CDN references are allowed', () => {
  assert.ok(isAllowedReferenceUrl('https://tr.rbxcdn.com/180DAY-abc/768/432/Image/Png/noFilter'))
  assert.ok(!isAllowedReferenceUrl('http://tr.rbxcdn.com/x'))
  assert.ok(!isAllowedReferenceUrl('https://rbxcdn.com.evil.test/x'))
  assert.ok(!isAllowedReferenceUrl('http://169.254.169.254/latest'))
  assert.ok(!isAllowedReferenceUrl(undefined))
})
