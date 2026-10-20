import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { pickRandomThumbnail } from './randomthumb.mjs'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const PNG = Buffer.from('png-bytes')

/** Roblox thumbnail listing answers `listed`; every rbxcdn download answers PNG bytes, except the `broken` ones. */
function stubRoblox(listed, broken = []) {
  const downloads = []
  globalThis.fetch = async (url) => {
    const href = String(url)
    if (href.startsWith('https://thumbnails.roblox.com/')) {
      const thumbnails = listed.map((imageUrl) => ({ state: 'Completed', imageUrl }))
      return new Response(JSON.stringify({ data: [{ universeId: 42, thumbnails }] }), { headers: { 'Content-Type': 'application/json' } })
    }
    if (href.includes('rbxcdn.com')) {
      downloads.push(href)
      return broken.includes(href) ? new Response('gone', { status: 404 }) : new Response(PNG, { headers: { 'Content-Type': 'image/png' } })
    }
    throw new Error(`unexpected fetch ${href}`)
  }
  return downloads
}

const game = { universeId: 42, name: 'Steal An Egg', thumbnailUrl: 'https://tr.rbxcdn.com/search-hit' }
const page = ['https://tr.rbxcdn.com/a', 'https://tr.rbxcdn.com/b', 'https://tr.rbxcdn.com/c', 'https://tr.rbxcdn.com/d']

test('a game with one thumbnail uses it without asking a model', async () => {
  stubRoblox(['https://tr.rbxcdn.com/only'])
  const picked = await pickRandomThumbnail({ ...game, thumbnailUrl: 'https://tr.rbxcdn.com/only' })
  assert.equal(picked.url, 'https://tr.rbxcdn.com/only')
  assert.equal(picked.index, 1)
  assert.equal(picked.count, 1)
  assert.equal(picked.why, 'The only thumbnail on the game page.')
  assert.deepEqual(picked.bytes, PNG)
})

test('a game whose page lists nothing falls back to the search thumbnail', async () => {
  stubRoblox([])
  const picked = await pickRandomThumbnail(game)
  assert.equal(picked.url, 'https://tr.rbxcdn.com/search-hit')
})

test('the same game gives a random one of its thumbnails each run, and only that one is downloaded', async () => {
  for (const [roll, url, index] of [[0, page[0], 1], [0.5, page[2], 3], [0.999, page[3], 4]]) {
    const downloads = stubRoblox(page)
    const picked = await pickRandomThumbnail(game, { random: () => roll })
    assert.deepEqual([picked.url, picked.index, picked.count, picked.pickedBy], [url, index, 4, 'random'])
    assert.equal(picked.why, 'Picked at random from the 4 on the game page.')
    assert.deepEqual(downloads, [url])
  }
})

test('a thumbnail that fails to download is skipped for another random one; none at all is an error', async () => {
  stubRoblox(page, [page[1]])
  const picked = await pickRandomThumbnail(game, { random: () => 0.3 })
  // 0.3 of four picks b, which is broken; 0.3 of the three left picks a.
  assert.equal(picked.url, page[0])
  stubRoblox(page, page)
  await assert.rejects(pickRandomThumbnail(game), /No thumbnail of "Steal An Egg" could be downloaded/)
})
