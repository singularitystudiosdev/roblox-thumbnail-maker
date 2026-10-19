import assert from 'node:assert/strict'
import { test } from 'node:test'
import { judgeThumbnails, readVerdict, shuffled } from './judge.mjs'

const row = (thumbnail, n, note = 'fine') => ({ thumbnail, coherent: n, fitsName: n, clean: n, clickable: n, note })

test('scores and the winner keep the slot numbers the judge saw, whatever the order', () => {
  // Shown in the order 3, 1, 2.
  const verdict = readVerdict({ scores: [row(3, 9), row(1, 5), row(2, 7)], winner: 3, reason: 'Clear subject — strong contrast.' }, [3, 1, 2])
  assert.equal(verdict.winnerSlot, 3)
  assert.equal(verdict.winnerFrom, 'judge')
  assert.deepEqual(verdict.scores.map((s) => [s.slot, s.total]), [[1, 20], [2, 28], [3, 36]])
  assert.equal(verdict.reason, 'Clear subject, strong contrast.')
})

test('a winner written as text still names its slot', () => {
  assert.equal(readVerdict({ scores: [row('Thumbnail 1', 4), row('2', 6)], winner: 'Thumbnail 2' }, [1, 2]).winnerSlot, 2)
})

test('an unusable winner number falls back to the top total; scores are clamped', () => {
  const verdict = readVerdict({ scores: [row(1, 3), { ...row(2, 8), clean: 99 }], winner: 7 }, [1, 2])
  assert.equal(verdict.winnerSlot, 2)
  assert.equal(verdict.winnerFrom, 'top score')
  assert.equal(verdict.scores[1].clean, 10)
})

test('scores for thumbnails that were not shown are ignored', () => {
  const verdict = readVerdict({ scores: [row(1, 9), row(3, 10)], winner: 1 }, [1, 2])
  assert.deepEqual(verdict.scores.map((s) => s.slot), [1])
})

test('a verdict with nothing usable is an error', () => {
  assert.throws(() => readVerdict({ scores: [], winner: '' }, [1, 2, 3]))
})

test('a lone thumbnail wins without asking a model', async () => {
  const verdict = await judgeThumbnails('Rob a Bank', [{ slot: 2, bytes: Buffer.from('x'), mimeType: 'image/png' }])
  assert.equal(verdict.winnerSlot, 2)
  assert.equal(verdict.model, null)
})

test('shuffling keeps every item', () => {
  const out = shuffled([1, 2, 3], () => 0)
  assert.deepEqual([...out].sort(), [1, 2, 3])
  assert.deepEqual(out, [2, 3, 1])
})
