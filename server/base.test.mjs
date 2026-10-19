import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BASE_RUBRICS, rateBases, readBase } from './base.mjs'

const png = (name) => ({ name, mimeType: 'image/png', bytes: Buffer.from(name) })
const replies = { polish: { baseA: 6, baseB: 3, why: 'p' }, genre: { baseA: 8, baseB: 2, why: 'g' }, strategy: { remixA: 4, styleA: 7, styleB: 13, why: 's' } }

test('the panel rates each reference as the mean of its three rubrics, the strategy rubric taking the better use of Reference A', async () => {
  const asked = []
  const ask = async (request) => {
    asked.push(request)
    const rubric = BASE_RUBRICS.find((r) => request.label.endsWith(`(${r.name})`))
    return { value: replies[rubric.name], model: 'stub' }
  }
  const base = await rateBases('Make a burger', { nearest: png('Burgeria'), search: png('Burgerz'), style: png('style') }, { ask })
  // A: 6, 8 and max(4, 7); B: 3, 2 and 13 clamped to 10.
  assert.equal(base.nearestBase, 7)
  assert.equal(base.searchBase, 5)
  assert.deepEqual(base.panel.map((p) => p.rubric), ['polish', 'genre', 'strategy'])
  assert.equal(asked.length, 3)
  for (const request of asked) {
    assert.deepEqual(request.images.map((i) => i.label), ['Reference A', 'Reference B', 'Style image S'])
    assert.match(request.user, /^Creator's game: Make a burger\nReference A: a thumbnail of "Burgeria"\nReference B: a thumbnail of "Burgerz"\n/)
  }
})

test('a failed rubric is left out of the mean; the panel throws only when every rubric fails', async () => {
  const ask = async (request) => {
    if (!request.label.endsWith('(genre)')) throw new Error('locked')
    return { value: replies.genre, model: 'stub' }
  }
  const base = await rateBases('Make a burger', { nearest: png('A'), search: png('B'), style: png('S') }, { ask })
  assert.deepEqual([base.nearestBase, base.searchBase, base.panel.length], [8, 2, 1])
  await assert.rejects(rateBases('Make a burger', { nearest: png('A'), search: null, style: png('S') }, { ask: async () => { throw new Error('locked') } }), /Every reference base rubric failed/)
})

test('a reference the run did not find rates null', () => {
  const panel = [{ rubric: 'polish', a: 1, b: 7 }]
  assert.deepEqual(readBase(panel, { nearest: false, search: true }), { nearestBase: null, searchBase: 7, panel })
})
