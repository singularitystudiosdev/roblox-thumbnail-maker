import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { chosenIndex, pickCleanestThumbnail } from './cleanest.mjs'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const PNG = Buffer.from('png-bytes')

/** Roblox thumbnail listing answers `listed`; every rbxcdn download answers PNG bytes. */
function stubRoblox(listed) {
  globalThis.fetch = async (url) => {
    const href = String(url)
    if (href.startsWith('https://thumbnails.roblox.com/')) {
      const thumbnails = listed.map((imageUrl) => ({ state: 'Completed', imageUrl }))
      return new Response(JSON.stringify({ data: [{ universeId: 42, thumbnails }] }), { headers: { 'Content-Type': 'application/json' } })
    }
    if (href.includes('rbxcdn.com')) return new Response(PNG, { headers: { 'Content-Type': 'image/png' } })
    throw new Error(`unexpected fetch ${href}`)
  }
}

test('the chosen number must be one of the thumbnails shown', () => {
  assert.equal(chosenIndex({ thumbnail: 3 }, 4), 3)
  assert.equal(chosenIndex({ thumbnail: 'Thumbnail 2' }, 4), 2)
  assert.equal(chosenIndex({ thumbnail: 5 }, 4), null)
  assert.equal(chosenIndex({ thumbnail: 0 }, 4), null)
  assert.equal(chosenIndex({}, 4), null)
})

test('a game with one thumbnail uses it without asking a model', async () => {
  stubRoblox(['https://tr.rbxcdn.com/only'])
  const picked = await pickCleanestThumbnail({ universeId: 42, name: 'Steal An Egg', thumbnailUrl: 'https://tr.rbxcdn.com/only' })
  assert.equal(picked.url, 'https://tr.rbxcdn.com/only')
  assert.equal(picked.index, 1)
  assert.equal(picked.count, 1)
  assert.equal(picked.pickedBy, null)
  assert.deepEqual(picked.bytes, PNG)
})

test('a game whose page lists nothing falls back to the search thumbnail', async () => {
  stubRoblox([])
  const picked = await pickCleanestThumbnail({ universeId: 42, name: 'Steal An Egg', thumbnailUrl: 'https://tr.rbxcdn.com/search-hit' })
  assert.equal(picked.url, 'https://tr.rbxcdn.com/search-hit')
})
