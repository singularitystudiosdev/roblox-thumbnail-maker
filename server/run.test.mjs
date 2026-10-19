import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { listRuns, rejudgeRun } from './run.mjs'

const ID = '2026-10-19T04-05-22-531Z-e01f3485'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

function savedRun(thumbnails) {
  const outputs = mkdtempSync(join(tmpdir(), 'runs-'))
  mkdirSync(join(outputs, ID))
  for (const t of thumbnails) if (t.imageUrl) writeFileSync(join(outputs, ID, `thumbnail-${t.slot}.png`), PNG)
  const record = { id: ID, gameName: 'Rob a Bank', reference: { source: 'style' }, link: null, thumbnails, judge: { winnerSlot: 3 }, winnerSlot: 3 }
  writeFileSync(join(outputs, ID, 'run.json'), JSON.stringify(record))
  return outputs
}

// The icon maker stands in for the image model: only the winner gets an icon.
const iconStub = async (image, model) => ({ bytes: Buffer.concat([image.bytes, Buffer.from(model.key)]), mimeType: 'image/png', redrawn: true })

test('judging again replaces and saves the verdict, with an icon for the new winner only', async () => {
  // One finished thumbnail wins without a model, so this needs no network.
  const outputs = savedRun([
    { slot: 2, imageUrl: `/outputs/${ID}/thumbnail-2.png` },
    { slot: 3, error: 'fal returned no image' }
  ])
  const record = await rejudgeRun(outputs, ID, { icon: iconStub })
  assert.equal(record.winnerSlot, 2)
  assert.equal(JSON.parse(readFileSync(join(outputs, ID, 'run.json'), 'utf8')).winnerSlot, 2)
  assert.equal(listRuns(outputs)[0].winnerSlot, 2)
  const winner = record.thumbnails.find((t) => t.slot === 2)
  assert.equal(winner.iconUrl, `/outputs/${ID}/icon-2.png`)
  assert.equal(winner.iconRedrawn, true)
  // The icon is drawn by Nano Banana Pro, the one image model.
  assert.deepEqual(readFileSync(join(outputs, ID, 'icon-2.png')), Buffer.concat([PNG, Buffer.from('nano-banana-2.1')]))
  assert.equal(record.thumbnails.find((t) => t.slot === 3).iconUrl, undefined)
})

test('a winner that already has an icon keeps it when judged again', async () => {
  const outputs = savedRun([{ slot: 2, imageUrl: `/outputs/${ID}/thumbnail-2.png`, iconUrl: `/outputs/${ID}/icon-2.png` }])
  let calls = 0
  const record = await rejudgeRun(outputs, ID, {
    icon: async (...args) => {
      calls++
      return iconStub(...args)
    }
  })
  assert.equal(calls, 0)
  assert.equal(record.thumbnails[0].iconUrl, `/outputs/${ID}/icon-2.png`)
})

test('an unknown or malformed run id is not found', async () => {
  const outputs = savedRun([])
  assert.equal(await rejudgeRun(outputs, '2026-10-19T00-00-00-000Z-00000000'), null)
  assert.equal(await rejudgeRun(outputs, '../../etc'), null)
})
