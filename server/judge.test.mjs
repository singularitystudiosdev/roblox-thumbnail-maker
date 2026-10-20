import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import { combinePasses, JUDGE_SYSTEM, judgeContext, judgeRequest, judgeThumbnails, matchLevel, MAX_TOTAL, NAMED_MIN_PLAYING, pickLibrary, readVerdict, renumber, shuffled, similarPicks } from './judge.mjs'

const row = (image, n, note = 'fine') => ({ image, fitsGame: n, genreLook: n, clean: n, clickable: n, coherent: n, note })

test('scores and the winner keep the slot numbers the judge saw, whatever the order', () => {
  // Shown in the order 3, 1, 2: Image 1 is slot 3.
  const verdict = readVerdict({ scores: [row(1, 9), row(2, 5), row(3, 7)], winner: 1, reason: 'Image 1 has a clear subject — strong contrast.' }, [3, 1, 2])
  assert.equal(verdict.winnerSlot, 3)
  assert.equal(verdict.winnerFrom, 'judge')
  assert.deepEqual(verdict.scores.map((s) => [s.slot, s.total]), [[1, 25], [2, 35], [3, 45]])
  assert.equal(verdict.reason, 'Thumbnail 3 has a clear subject, strong contrast.')
  assert.equal(MAX_TOTAL, 50)
})

test('a winner written as text still names its slot', () => {
  assert.equal(readVerdict({ scores: [row('Image 1', 4), row('2', 6)], winner: 'Image 2' }, [1, 2]).winnerSlot, 2)
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

test('every image mention, single or listed, becomes its slot', () => {
  const order = [3, 2, 1]
  assert.equal(renumber('Image 1 beats image 3.', order), 'Thumbnail 3 beats Thumbnail 1.')
  assert.equal(renumber('Images 1 and 2 drift, Images 1, 2 and 3 all fit.', order), 'Thumbnails 3 and 2 drift, Thumbnails 3, 2 and 1 all fit.')
  assert.equal(renumber('Image 4 is the context.', order), 'Image 4 is the context.')
})

// Every criterion the same mark, unless `fits` overrides fitsGame.
const pass = (winnerSlot, totals, fits = {}) => ({
  winnerSlot,
  reason: `pass for ${winnerSlot}`,
  scores: Object.entries(totals).map(([slot, total]) => ({
    slot: Number(slot),
    ...Object.fromEntries(['fitsGame', 'genreLook', 'clean', 'clickable', 'coherent'].map((c) => [c, total / 5])),
    ...(fits[slot] != null ? { fitsGame: fits[slot] } : {}),
    total,
    note: `note ${slot}`
  }))
})

test("the judge's votes pick the winner, not the summed marks", () => {
  // As on the Swat set: most passes pick the striking one while the summed marks of the good ones sit a point apart.
  const combined = combinePasses([pass(3, { 2: 41, 3: 42 }), pass(3, { 2: 42, 3: 41 }), pass(2, { 2: 43, 3: 37 })])
  assert.equal(combined.winnerSlot, 3)
  assert.deepEqual(combined.votes, { 3: 2, 2: 1 })
  assert.equal(combined.reason, 'pass for 3')
  assert.deepEqual(combined.scores.map((s) => [s.slot, s.total]), [[2, 42], [3, 40]])
})

test('a split vote goes to the higher mean total', () => {
  assert.equal(combinePasses([pass(1, { 1: 30, 2: 40 }), pass(2, { 1: 30, 2: 40 })]).winnerSlot, 2)
})

test('a thumbnail that misleads players cannot win on its other marks', () => {
  const combined = combinePasses([pass(1, { 1: 44, 2: 38 }, { 1: 2 }), pass(1, { 1: 44, 2: 38 }, { 1: 3 })])
  assert.equal(combined.winnerSlot, 2)
  assert.equal(combined.minFitsGame, 5)
  assert.match(combined.reason, /^Thumbnail 2 scored best across the judge's passes\. note 2$/)
  // When none fits, the vote still decides among all of them.
  assert.equal(combinePasses([pass(2, { 1: 30, 2: 20 }, { 1: 2, 2: 2 })]).winnerSlot, 2)
})

test('equal totals go to the thumbnail more passes voted for', () => {
  assert.equal(combinePasses([pass(2, { 1: 40, 2: 40 }), pass(2, { 1: 40, 2: 40 }), pass(1, { 1: 40, 2: 40 })]).winnerSlot, 2)
})

test("a linked game's own thumbnail and description reach the judge; a nearest game only as text", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'judge-'))
  writeFileSync(join(dir, 'reference.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))
  const reference = { source: 'roblox', name: 'Break and Steal an Egg', placeId: 114326934417838, universeId: 7, playing: 122812, imageUrl: '/outputs/x/reference.png' }
  const description = 'Break eggs with your pickaxe!  https://discord.gg/x  Steal the lava eggs.'
  const details = async (ids) => [{ universeId: ids[0], description }]
  const place = async () => ({ universeId: 7, name: 'Break and Steal an Egg', playing: 122812, description })
  const link = { placeId: '114326934417838' }

  const own = await judgeContext({ reference, link }, dir, { details, place, thumbnailOf: () => assert.fail('the saved reference is that game') })
  assert.equal(own.own, true)
  assert.equal(own.image.mimeType, 'image/png')
  assert.equal(own.description, 'Break eggs with your pickaxe! Steal the lava eggs.')
  assert.match(judgeRequest('Break and Steal an Egg', 3, own), /creator's own game on Roblox[\s\S]*last image is its current Roblox thumbnail[\s\S]*Image 1, Image 2, Image 3/)

  // The remixes started from a more played game: the judge still sees the creator's own game and its thumbnail.
  const fetched = []
  const other = await judgeContext({ reference: { ...reference, universeId: 99, name: 'Steal An Egg' }, link }, dir, {
    details,
    place,
    thumbnailOf: async (id) => (fetched.push(id), { bytes: Buffer.from('x'), mimeType: 'image/png' })
  })
  assert.equal(other.own, true)
  assert.equal(other.name, 'Break and Steal an Egg')
  assert.deepEqual(fetched, [7])

  // Without a link the popular game reaches the judge as text only: no scene to copy, and no look to match
  // (a bold cartoon thumbnail once lost to a realistic still life because the nearest game was realistic).
  const nearest = await judgeContext({ reference, link: null }, dir, { details })
  assert.equal(nearest.own, false)
  assert.equal(nearest.image, null)
  assert.equal('look' in nearest, false)
  const request = judgeRequest('A axe game', 3, nearest)
  assert.match(request, /It is a different game: use it only to understand this kind of game, not as the creator's game/)
  assert.doesNotMatch(request, /render style/)

  assert.equal(await judgeContext({ reference: { source: 'style' }, link: null }, dir, { details }), null)
  assert.doesNotMatch(judgeRequest('Rob a Bank', 2, null), /Context/)
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

test("an attached reference image is the judge's context: shown last, never a candidate", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'attached-'))
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  writeFileSync(join(dir, 'attached.png'), png)
  const run = { link: null, reference: null, attachment: { used: true, imageUrl: '/outputs/x/attached.png' } }
  const context = await judgeContext(run, dir)
  assert.equal(context.attached, true)
  assert.deepEqual(context.image.bytes, png)
  assert.match(judgeRequest('Rob a Bank', 2, context), /creator attached a reference image[\s\S]*It is context, not a candidate[\s\S]*Candidates: Image 1, Image 2\.$/)
  // An attachment the prompt did not ask for is not context.
  assert.equal(await judgeContext({ ...run, attachment: { ...run.attachment, used: false } }, dir), null)
})

test('a game with the creators name is the context only when players know it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'named-'))
  writeFileSync(join(dir, 'reference.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))
  const details = async () => [{ description: 'Climb the tower.' }]
  const popular = { source: 'roblox', name: 'Tower of Hell', universeId: 1, playing: 21937, imageUrl: '/outputs/x/reference.png' }
  const known = await judgeContext({ gameName: 'Tower of Hell', reference: popular, link: null }, dir, { details })
  assert.equal(known.named, true)
  assert.match(judgeRequest('Tower of Hell', 2, known), /exactly the creator's game name[\s\S]*current Roblox thumbnail/)

  // A game nobody plays is no game "players already know": the nearest game's text is the context instead.
  const obscure = { ...popular, playing: NAMED_MIN_PLAYING - 1 }
  const unknown = await judgeContext({ gameName: 'Tower of Hell', reference: obscure, link: null }, dir, { details })
  assert.equal(unknown.named, undefined)
  assert.equal(unknown.own, false)
})

test('the rubric never marks a thumbnail down for being less realistic than another game', () => {
  assert.doesNotMatch(JUDGE_SYSTEM, /realistic, cinematic renders, a simulator/)
  assert.match(JUDGE_SYSTEM, /realism is never a reason to score one above another/)
  assert.match(JUDGE_SYSTEM, /flat 2D or outlined drawing scores 1 to 4/)
})

test("the creator's earlier picks become worked examples: similar games first, never the run itself", async () => {
  const outputs = mkdtempSync(join(tmpdir(), 'picks-'))
  const make = (id, record) => {
    mkdirSync(join(outputs, id), { recursive: true })
    writeFileSync(join(outputs, id, 'run.json'), JSON.stringify(record))
  }
  const thumbnails = [1, 2, 3].map((slot) => ({ slot, imageUrl: `/outputs/x/thumbnail-${slot}.png` }))
  const judge = (winner) => ({ winnerSlot: winner, scores: [1, 2, 3].map((slot) => ({ slot, total: slot === winner ? 45 : 40 - slot })) })
  make('2026-10-19T01-a', { id: '2026-10-19T01-a', gameName: 'Rob a Bank', thumbnails, judge: judge(3), userPick: { slot: 1, at: 'x' } })
  make('2026-10-19T02-b', { id: '2026-10-19T02-b', gameName: 'Bake a Cake', thumbnails, judge: judge(2), userPick: { slot: 2, accept: [2, 3], at: 'x' } })
  make('2026-10-19T03-c', { id: '2026-10-19T03-c', gameName: 'Swat a House', thumbnails, judge: judge(1) }) // no pick
  make('2026-10-19T04-d', { id: '2026-10-19T04-d', gameName: 'Rob a Bank (again)', thumbnails, judge: judge(1) })
  const library = pickLibrary(outputs, new Map([['2026-10-19T04-d', [2]]]))
  assert.deepEqual(library.map((e) => e.id), ['2026-10-19T01-a', '2026-10-19T02-b', '2026-10-19T04-d'])
  // The thumbnail they took, and the best total among those they did not (never one they accepted).
  assert.deepEqual(library.map((e) => [e.chosen, e.passed]), [[1, 3], [2, 1], [2, 1]])
  const run = { id: '2026-10-19T05-e', gameName: 'Rob a Bank' }
  assert.deepEqual(similarPicks(run, library, 2).map((e) => e.id), ['2026-10-19T04-d', '2026-10-19T01-a'])
  // The run being judged is never its own example.
  assert.ok(!similarPicks({ ...run, id: '2026-10-19T01-a' }, library, 3).some((e) => e.id === '2026-10-19T01-a'))
  // A backtest leaves out twin runs of the same game too ("rob a bank" is "Rob a Bank"); a different name stays.
  assert.deepEqual(similarPicks({ ...run, gameName: 'rob a bank' }, library, 3, { sameGame: false }).map((e) => e.id), ['2026-10-19T04-d', '2026-10-19T02-b'])

  const png = await sharp({ create: { width: 64, height: 36, channels: 3, background: '#c33' } }).png().toBuffer()
  for (const id of ['2026-10-19T01-a', '2026-10-19T02-b']) for (const slot of [1, 2, 3]) writeFileSync(join(outputs, id, `thumbnail-${slot}.png`), png)
  const context = await judgeContext({ ...run, link: null, reference: null }, join(outputs, '2026-10-19T05-e'), { library: library.slice(0, 2) })
  assert.equal(context.bare, true)
  assert.equal(context.examples.length, 2)
  assert.equal(context.examples[0].chosen.mimeType, 'image/jpeg')
  const request = judgeRequest('Rob a Bank', 3, context)
  assert.match(request, /2 pairs[\s\S]*never copy their subjects[\s\S]*Candidates: Image 1, Image 2, Image 3\.$/)
  assert.doesNotMatch(request, /Context: the most played/)
  // Without examples the request is the plain one.
  assert.doesNotMatch(judgeRequest('Rob a Bank', 3, null), /pairs/)
  assert.equal(await judgeContext({ ...run, link: null, reference: null }, join(outputs, '2026-10-19T05-e'), { library, examples: 0 }), null)
})

test("a reference game has the creator's very name only when its words are the same: tags, emoji, plurals and filler aside", () => {
  assert.equal(matchLevel('Steal an Egg', 'Steal An Egg'), 'exact')
  assert.equal(matchLevel('Bake a Cake', '[UPD🍓] Bake Cakes!'), 'exact')
  assert.equal(matchLevel('Break and Steal an Egg', 'Steal An Egg'), 'near')
  assert.equal(matchLevel('Rob a Bank', '💰 Deadly Heist 💰'), 'none')
  assert.equal(matchLevel('Rob a Bank', null), 'none')
})
