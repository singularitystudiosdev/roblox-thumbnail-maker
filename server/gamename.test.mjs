import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveGameName } from './gamename.mjs'

const noLookup = () => assert.fail('a link with a slug needs no Roblox lookup')

test('a Roblox link is named by its slug', async () => {
  const named = await resolveGameName('https://www.roblox.com/games/107778070777162/Steal-An-Egg', { lookupPlace: noLookup })
  assert.equal(named.gameName, 'Steal an Egg')
  assert.equal(named.namedBy, 'link')
  assert.deepEqual(named.link, { placeId: '107778070777162', title: 'Steal an Egg', url: 'https://www.roblox.com/games/107778070777162/Steal-An-Egg' })
})

test('a link inside a request wrapper still names the game by itself', async () => {
  for (const input of [
    'Make me a thumbnail for my game https://www.roblox.com/games/107778070777162/Steal-An-Egg',
    'make a thumbnail for https://www.roblox.com/games/107778070777162/Steal-An-Egg?gameSetTypeId=1',
    'roblox.com/games/107778070777162/Steal-An-Egg',
    // The request after the link, as typed in the app: it named the game "Steal an Egg Make a thumbnail for my game".
    'https://www.roblox.com/games/107778070777162/Steal-An-Egg Make a thumbnail for my game',
    'https://www.roblox.com/games/107778070777162/Steal-An-Egg thumbnail please'
  ]) {
    const named = await resolveGameName(input, { lookupPlace: noLookup })
    assert.equal(named.gameName, 'Steal an Egg', input)
    assert.equal(named.namedBy, 'link', input)
  }
})

test('a link with no slug is named by Roblox, decoration removed', async () => {
  const named = await resolveGameName('https://www.roblox.com/games/107778070777162', {
    lookupPlace: async (placeId) => ({ name: placeId === '107778070777162' ? '[🥚] Steal An Egg!' : 'wrong' })
  })
  assert.equal(named.gameName, 'Steal An Egg')
  assert.equal(named.namedBy, 'link')
})

test('a description is the game name word for word', async () => {
  const named = await resolveGameName('A axe throwing game with a bacon hair in the thumbnail', { lookupPlace: noLookup })
  assert.equal(named.gameName, 'A axe throwing game with a bacon hair in the thumbnail')
  assert.equal(named.namedBy, 'typed')
  assert.equal(named.link, null)
})

test('a description that cites a link keeps its words, the link read as its name', async () => {
  const named = await resolveGameName('A game like https://www.roblox.com/games/107778070777162/Steal-An-Egg but with axes', {
    lookupPlace: noLookup
  })
  assert.equal(named.gameName, 'A game like Steal an Egg but with axes')
  assert.equal(named.namedBy, 'typed')
  assert.equal(named.link.title, 'Steal an Egg')
})
