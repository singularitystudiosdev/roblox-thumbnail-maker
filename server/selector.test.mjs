import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pickedArms, planPickedSlots } from './run.mjs'
import { readFit, hasFeatures } from './fit.mjs'
import { ARMS, DEFAULT_PARAMS, builtOnExact, chooseArm, chooseByPanel, coWinners, drawNoise, exampleOf, expectedRegrets, fallbackArm, featureOf, loadExamples, matchLevel, nameTokens, promptType, regretsOf } from './selector.mjs'

const fit = (nearestFit, searchFit, nameClarity) => ({ nearestFit, searchFit, nameClarity })
const regret = (winner, others = 6) => Object.fromEntries(ARMS.map((a) => [a, a === winner ? 0 : others]))
const example = (id, game, f, winner, refs = { nearest: `n-${id}`, search: `s-${id}` }, refNames = { nearest: 'Other Game', search: 'Another Game' }) => ({ id, game, fit: f, refs, refNames, regret: regret(winner) })

const fullRun = (scores, extra = {}) => ({
  id: 'r',
  mode: 'standard',
  gameName: 'Steal an Egg',
  slots: [
    { slot: 1, strategy: 'template' },
    { slot: 2, strategy: 'remix' },
    { slot: 3, strategy: 'search' },
    { slot: 4, strategy: 'meta' },
    { slot: 5, strategy: 'plain' },
    { slot: 6, strategy: 'remix' }
  ],
  judge: { scores: scores.map((total, i) => ({ slot: i + 1, total })) },
  ...extra
})

test('name words drop tags, emoji, plurals and filler', () => {
  assert.deepEqual(nameTokens('[🎃] 💎 ROB IT'), ['rob', 'it'])
  assert.deepEqual(nameTokens('Make a thumbnail for my game Steal an Eggs'), ['steal', 'egg'])
})

test('regret is each strategy short of the best thumbnail, a strategy drawn twice counting its mean', () => {
  assert.deepEqual(regretsOf(fullRun([40, 46, 44, 45, 35, 42])), { template: 6, remix: 2, search: 2, meta: 1, plain: 11 })
})

test('a run that did not draw every strategy, or was not judged, teaches nothing', () => {
  const picked = { ...fullRun([40, 44]), slots: [{ slot: 1, strategy: 'meta' }, { slot: 2, strategy: 'meta' }] }
  assert.equal(regretsOf(picked), null)
  assert.equal(regretsOf({ ...fullRun([]), judge: null }), null)
  // An explore run counts only once it recorded its reference ratings.
  assert.equal(exampleOf(fullRun([40, 46, 44, 45, 35, 42])), null)
  assert.equal(exampleOf(fullRun([40, 46, 44, 45, 35, 42], { selection: { fit: fit(9, 8, 5) } })).regret.meta, 1)
})

test('with no examples the pick is meta, the best single strategy in the backtest', () => {
  assert.equal(chooseArm({ game: 'Anything', fit: fit(5, 5, 5), refs: {} }, []).arm, 'meta')
})

test('a prompt\'s type: whether a reference game has its name, and whether it is a description', () => {
  assert.equal(matchLevel('Steal an Egg', 'Steal An Egg'), 'exact')
  assert.equal(matchLevel('Break and Steal an Egg', 'Steal An Egg'), 'near')
  assert.equal(matchLevel('Rob a Bank', '💰 Deadly Heist 💰'), 'none')
  assert.deepEqual(promptType({ game: 'Fake an Egg', refNames: { nearest: 'Steal An Egg', search: 'Fake an Egg' } }), { match: 'exact', descriptive: false })
  assert.deepEqual(promptType({ game: 'Run on a treadmill in a basement', refNames: { nearest: 'Unbox A Treadmill', search: null } }), { match: 'near', descriptive: true })
})

test('a prompt like past runs follows what won them; an unlike one leans on the mean', () => {
  const examples = [
    example('a', 'bury a body', fit(6, 3, 5), 'search'),
    example('b', 'bury a body', fit(6, 3, 5), 'search'),
    example('c', 'Fake an Egg', fit(10, 4, 4), 'meta'),
    example('d', 'Swat a House', fit(8, 6, 5), 'meta'),
    example('e', 'Banana man', fit(5, 6, 3), 'template')
  ]
  const same = chooseArm({ game: 'Bury a Body', fit: fit(6, 3, 5), refs: { nearest: 'n-a', search: 's-a' }, refNames: examples[0].refNames }, examples)
  assert.equal(same.arm, 'search')
  assert.equal(same.closest[0].winner, 'search')
  assert.equal(chooseArm({ game: 'Fly a kite over the ocean', fit: fit(10, 4, 9), refs: {} }, examples).arm, 'meta')
})

test('the plain template on a game that won before counts whichever lookup finds that game now', () => {
  // Fake an Egg was the nearest game when meta won; now the search finds it and the nearest is another game.
  const examples = [
    example('f', 'Fake an Egg', fit(10, 4, 4), 'meta', { nearest: '107', search: '100' }, { nearest: 'Fake an Egg', search: 'Fake a Brainrot' }),
    example('g', 'Swat a House', fit(8, 6, 5), 'meta'),
    example('h', 'Banana man', fit(5, 6, 3), 'template')
  ]
  const drifted = { game: 'Fake an Egg', fit: fit(3, 9, 4), refs: { nearest: '105', search: '107' }, refNames: { nearest: 'Steal An Egg', search: 'Fake an Egg' } }
  assert.equal(chooseArm(drifted, examples).arm, 'search')
})

test('examples are every explore run read fresh, the shipped seed filling in only what a run never recorded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'selector-'))
  const seed = join(dir, 'seed.json')
  writeFileSync(
    seed,
    JSON.stringify({
      examples: [
        example('2026-10-19T06-09-32-000Z-aaaaaaaa', 'bury a body', fit(6, 3, 5), 'search'),
        example('2026-10-19T06-10-00-000Z-dddddddd', 'only shipped', fit(2, 2, 2), 'plain')
      ]
    })
  )
  const outputs = join(dir, 'outputs')
  for (const [id, run] of [
    // Rated before ratings were recorded, then picked by the creator: shipped ratings, the run's own verdict.
    ['2026-10-19T06-09-32-000Z-aaaaaaaa', fullRun([40, 46, 44, 45, 35, 42], { userPick: { slot: 1 } })],
    ['2026-10-19T08-00-00-000Z-bbbbbbbb', fullRun([40, 46, 44, 45, 35, 42], { id: 'x', selection: { fit: fit(9, 8, 5) } })],
    // Never rated anywhere: not an example.
    ['2026-10-19T08-01-00-000Z-cccccccc', fullRun([40, 46, 44, 45, 35, 42])]
  ]) {
    mkdirSync(join(outputs, id), { recursive: true })
    writeFileSync(join(outputs, id, 'run.json'), JSON.stringify(run))
  }
  const examples = loadExamples(outputs, seed)
  assert.equal(examples.length, 3)
  const picked = examples.find((e) => e.id === '2026-10-19T06-09-32-000Z-aaaaaaaa')
  assert.deepEqual(picked.fit, fit(6, 3, 5))
  assert.equal(picked.regret.template, 0)
  assert.ok(examples.some((e) => e.id === '2026-10-19T06-10-00-000Z-dddddddd'))
})

test('a picked run draws one thumbnail of each of its top two strategies, each with its exact prompt; a top-up draws the next two', () => {
  assert.deepEqual(planPickedSlots('Steal an Egg', ['meta', 'template']), [
    { slot: 1, strategy: 'meta', prompt: 'Make me a thumbnail for my game "Steal an Egg" in the style of my reference image. No text. 16:9 Ratio.' },
    { slot: 2, strategy: 'template', prompt: 'Make me a thumbnail for my roblox game "Steal an Egg" in the style of my reference image different characters. No text. 16:9 Ratio.' }
  ])
  assert.deepEqual(planPickedSlots('Steal an Egg', ['remix', 'plain'], 3).map((s) => [s.slot, s.prompt]), [
    [3, 'Make this thumbnail but from a novel perspective. No text.'],
    [4, 'Make me a thumbnail for my game "Steal an Egg" in the style of my reference image. No text. 16:9 Ratio.']
  ])
  assert.deepEqual(pickedArms({ arm: 'remix', runnerUp: 'meta', ranked: ['remix', 'meta', 'search', 'plain', 'template'] }), { drawn: ['remix', 'meta'], topUp: ['search', 'plain'] })
  // A selection saved before the ranking existed draws its pick and runner-up.
  assert.deepEqual(pickedArms({ arm: 'meta', runnerUp: 'template' }), { drawn: ['meta', 'template'], topUp: [] })
})

test('the creator\'s own pick outranks the judge: it wins, and every strategy the judge put above it falls behind', () => {
  // The judge put meta (45) on top; the creator picked the remix in slot 2 (46 is ignored, its score 40 here).
  const run = fullRun([40, 40, 44, 45, 35, 42], { userPick: { slot: 2 } })
  const r = regretsOf(run)
  assert.equal(r.remix, 0)
  assert.equal(r.meta, 2)
  assert.equal(r.search, 2)
  assert.equal(r.plain, 5)
})

test('examples drawn with another image model count less than ones drawn with the run\'s own', () => {
  const pro = [1, 2, 3, 4].map((i) => ({ ...example(`p${i}`, `Game ${i}`, fit(5, 5, 5), 'meta'), model: 'nano-banana-pro' }))
  const now = [1, 2].map((i) => ({ ...example(`n${i}`, `Fresh ${i}`, fit(5, 5, 5), 'plain'), model: 'nano-banana-2.1' }))
  const current = { game: 'Something new', fit: fit(5, 5, 5), refs: {}, model: 'nano-banana-2.1' }
  assert.equal(chooseArm(current, [...pro, ...now]).arm, 'plain')
  assert.equal(chooseArm({ ...current, model: 'nano-banana-pro' }, [...pro, ...now]).arm, 'meta')
})

test('the model\'s ratings are clamped, the genre is one of the list, and a missing reference rates null', () => {
  const read = readFit({ fitA: 14, fitB: 'x', nameClarity: 0, genre: 'Tower-Defense', realism: 3.4, abstractness: '7', knownGame: 2, artA: 9, artB: 4, why: 'It fits — well.' }, { nearest: true, search: false })
  assert.deepEqual(
    { ...read, why: undefined },
    { nearestFit: 10, searchFit: null, nameClarity: 1, genre: 'tower_defense', realism: 3, abstractness: 7, knownGame: 2, nearestArt: 9, searchArt: null, why: undefined }
  )
  assert.equal(read.why, 'It fits, well.')
  assert.equal(readFit({ genre: 'cooking' }, { nearest: false, search: false }).genre, 'other')
  assert.equal(hasFeatures(read), true)
  assert.equal(hasFeatures({ nearestFit: 5, searchFit: 5, nameClarity: 5 }), false)
})

test('a feature is read from the rating, a reference\'s art from the reference the strategy starts from', () => {
  const item = { game: 'Run from a giant rubber duck in a flooded school', fit: { ...fit(4, 8, 9), realism: 6, nearestArt: 3, searchArt: 8, genre: 'horror' } }
  assert.equal(featureOf(item, 'meta', 'art'), 3)
  assert.equal(featureOf(item, 'remix', 'art'), 3)
  assert.equal(featureOf(item, 'search', 'art'), 8)
  assert.equal(featureOf(item, 'plain', 'art'), 'style')
  assert.equal(featureOf(item, 'plain', 'realism'), 6)
  assert.equal(featureOf(item, 'plain', 'genre'), 'horror')
  assert.equal(featureOf(item, 'plain', 'words'), 7)
  assert.equal(featureOf({ game: 'x', fit: fit(1, 1, 1) }, 'plain', 'realism'), null)
})

test('a request feature, when asked for, makes runs like this one in it count more; unrated ones change nothing', () => {
  const rated = (id, winner, realism) => ({ ...example(id, 'Same name', { ...fit(5, 5, 5), realism }, winner), model: null })
  const examples = [rated('a', 'template', 9), rated('b', 'template', 9), rated('c', 'plain', 1), rated('d', 'plain', 1)]
  const current = { game: 'Same name', fit: { ...fit(5, 5, 5), realism: 9 }, refs: {}, refNames: {} }
  const off = expectedRegrets(current, examples)
  const on = expectedRegrets(current, examples, { ...DEFAULT_PARAMS, features: ['realism'], featureWeight: 4 })
  assert.ok(off.template - off.plain < 1e-9 && off.plain - off.template < 1e-9)
  assert.ok(on.template < on.plain)
  assert.equal(chooseArm(current, examples, { ...DEFAULT_PARAMS, features: ['realism'], featureWeight: 4 }).arm, 'template')
  const unrated = { game: 'Same name', fit: fit(5, 5, 5), refs: {}, refNames: {} }
  assert.deepEqual(expectedRegrets(unrated, examples, { ...DEFAULT_PARAMS, features: ['realism'], featureWeight: 4 }), expectedRegrets(unrated, examples))
  // Splitting the typed prior by a feature pulls toward the runs on the same side of it.
  const split = expectedRegrets(current, examples, { ...DEFAULT_PARAMS, split: ['realism'], typeShrink: 0.1, prior: 50 })
  assert.ok(split.template < split.plain)
})

test('ratings the shipped seed carries beyond the run\'s own are filled in, the run\'s own kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'selector-'))
  const seed = join(dir, 'seed.json')
  const id = '2026-10-19T08-00-00-000Z-bbbbbbbb'
  writeFileSync(seed, JSON.stringify({ examples: [example(id, 'Steal an Egg', { ...fit(1, 1, 1), realism: 7, genre: 'simulator' }, 'meta')] }))
  mkdirSync(join(dir, 'outputs', id), { recursive: true })
  writeFileSync(join(dir, 'outputs', id, 'run.json'), JSON.stringify(fullRun([40, 46, 44, 45, 35, 42], { selection: { fit: fit(9, 8, 5) } })))
  const [loaded] = loadExamples(join(dir, 'outputs'), seed)
  assert.deepEqual(loaded.fit, { ...fit(9, 8, 5), realism: 7, genre: 'simulator' })
})

test('the strategy built on a game with the prompt\'s exact name: remix on the nearest game, else search on the search game', () => {
  assert.equal(builtOnExact({ game: 'Doors', refNames: { nearest: 'DOORS 🚨', search: 'DOORS HARDCORE' } }), 'remix')
  assert.equal(builtOnExact({ game: 'Blade Ball', refNames: { nearest: '[🎃] Ball VS Ball', search: 'Blade Ball' } }), 'search')
  assert.equal(builtOnExact({ game: 'Rob a Bank', refNames: { nearest: 'Deadly Heist', search: 'Mega Escape Bank Rob' } }), null)
})

test('the exact name bonus settles a close call toward the strategy built on the game that exists', () => {
  // Past runs: on an exact game meta beat remix by a hair, so the memory alone leans meta.
  const exact = (id, winner) => ({ ...example(id, `Game ${id}`, fit(9, 5, 5), winner, { nearest: `n-${id}`, search: `s-${id}` }, { nearest: `Game ${id}`, search: 'Other' }), model: null })
  const examples = [exact('a', 'meta'), exact('b', 'meta'), exact('c', 'remix')]
  const current = { game: 'Game z', fit: fit(9, 5, 5), refs: {}, refNames: { nearest: 'Game z', search: 'Other' } }
  assert.equal(chooseArm(current, examples, { ...DEFAULT_PARAMS, exactBonus: 0 }).arm, 'meta')
  assert.equal(chooseArm(current, examples, { ...DEFAULT_PARAMS, exactBonus: 8 }).arm, 'remix')
  // No game has the name: the bonus changes nothing.
  const none = { ...current, refNames: { nearest: 'Something else', search: 'Other' } }
  assert.deepEqual(chooseArm(none, examples, { ...DEFAULT_PARAMS, exactBonus: 8 }).expected, chooseArm(none, examples, { ...DEFAULT_PARAMS, exactBonus: 0 }).expected)
})

test('noise between draws and the strategies the judge cannot tell from the best', () => {
  const run = fullRun([40, 46, 44, 45, 35, 42, 44.5])
  run.slots.push({ slot: 7, strategy: 'remix' })
  // remix drew 46, 42 and 44.5: spread sqrt(((46-44.17)^2 + (42-44.17)^2 + (44.5-44.17)^2) / 2)
  const sd = drawNoise([run])
  assert.ok(Math.abs(sd - 2.0) < 0.1, String(sd))
  assert.equal(drawNoise([{ slots: [{ slot: 1, strategy: 'meta' }], judge: { scores: [{ slot: 1, total: 40 }] } }]), null)
  const ex = exampleOf({ ...run, selection: { fit: fit(9, 8, 5) } })
  assert.deepEqual(ex.drawn, { template: 1, remix: 3, search: 1, meta: 1, plain: 1 })
  // Meta fell 1 point short of the best, with a draw spread of 2 points: not a clear loss. Plain fell 11 short: a clear one.
  const co = coWinners(ex, 2)
  assert.ok(co.includes('meta') && co.includes('search') && !co.includes('plain'))
  // The creator\'s pick ends the doubt.
  assert.deepEqual(coWinners(exampleOf({ ...run, userPick: { slot: 4 }, selection: { fit: fit(9, 8, 5) } }), 2), ['meta'])
})

test('a run whose references could not be rated takes the strategy with the lowest mean regret on its image model', () => {
  const withModel = (e, model) => ({ ...e, model })
  const examples = [
    withModel(example('a', 'Rob a Bank', fit(5, 5, 5), 'plain'), 'nano-banana-2.1'),
    withModel(example('b', 'Bake a Cake', fit(5, 5, 5), 'plain'), 'nano-banana-2.1'),
    withModel(example('c', 'Doors', fit(5, 5, 5), 'template'), 'nano-banana-2.1'),
    withModel(example('d', 'Blade Ball', fit(5, 5, 5), 'meta'), 'nano-banana-pro'),
    withModel(example('e', 'Grow a Garden', fit(5, 5, 5), 'meta'), 'nano-banana-pro'),
    withModel(example('f', 'Tower of Hell', fit(5, 5, 5), 'meta'), 'nano-banana-pro')
  ]
  assert.deepEqual([fallbackArm(examples, 'nano-banana-2.1').arm, fallbackArm(examples, 'nano-banana-2.1').runnerUp], ['plain', 'template'])
  assert.equal(fallbackArm(examples, 'nano-banana-pro').arm, 'meta')
  assert.equal(fallbackArm(examples, 'another-model').arm, 'meta')
  assert.equal(fallbackArm([], 'nano-banana-2.1').arm, 'meta')
})

test('once the creator has picked in runs of a model, runs only the judge labelled stop deciding the pick', () => {
  const model = 'nano-banana-2.1'
  const at = (e, extra) => ({ ...e, model, ...extra })
  // Two judge-only runs say plain; the creator's one pick on a like run says remix.
  const examples = [
    at(example('a', 'Rob a House', fit(5, 5, 5), 'plain')),
    at(example('b', 'Rob a Shop', fit(5, 5, 5), 'plain')),
    at(example('c', 'Rob a Store', fit(5, 5, 5), 'remix'), { picked: true })
  ]
  const current = { game: 'Rob a Mall', fit: fit(5, 5, 5), refs: { nearest: 'n-x', search: 's-x' }, refNames: { nearest: 'Other Game', search: 'Another Game' }, model }
  const choice = chooseArm(current, examples)
  assert.equal(choice.arm, 'remix')
  assert.equal(choice.learnedFrom, 1)
  assert.equal(choice.ranked.length, ARMS.length)
  // Counted fully, the judge's two runs outvote the one pick.
  assert.equal(chooseArm(current, examples, { ...DEFAULT_PARAMS, judgeOnly: 1 }).arm, 'plain')
  // With no pick yet for the model, the judge's runs count fully.
  assert.equal(chooseArm(current, examples.map((e) => ({ ...e, picked: false }))).arm, 'plain')
})

test('the panel pick draws from the two best starting images, the style image rating the bar', () => {
  const model = 'nano-banana-2.1'
  const run = (nearestBase, searchBase, art = {}) => ({ game: 'Make a burger', fit: { ...fit(5, 5, 5), nearestArt: 5, searchArt: 5, ...art }, base: { nearestBase, searchBase }, refs: { nearest: 'n', search: 's' }, refNames: { nearest: 'Other Game', search: 'Another Game' }, model })
  const drawn = (current, examples = []) => chooseArm(current, examples).ranked.slice(0, 2)
  // Both references beat the style image: one thumbnail from each, never two from one image.
  assert.deepEqual(drawn(run(8, 7)), ['remix', 'search'])
  // One does: it, then the style image.
  assert.deepEqual(drawn(run(3, 8.7)), ['search', 'template'])
  assert.deepEqual(drawn(run(7, 2)), ['remix', 'template'])
  // Neither does: both style strategies.
  assert.deepEqual(drawn(run(4.3, 4.8)), ['template', 'plain'])
  // Flat 2D art is never a starting point, however it rates.
  assert.deepEqual(drawn(run(7.1, 1.3, { nearestArt: 2 })), ['template', 'plain'])
  // A reference the run did not find is never drawn from.
  assert.deepEqual(drawn(run(null, 8)), ['search', 'template'])
  const choice = chooseArm(run(8, 7), [])
  assert.equal(choice.method, 'panel')
  assert.equal(choice.ranked.length, ARMS.length)
  assert.deepEqual(choice.base, { nearestBase: 8, searchBase: 7, bar: DEFAULT_PARAMS.baseBar, flat: { nearest: false, search: false } })
  // Without panel ratings the memory of past runs picks, as before.
  assert.equal(chooseArm({ ...run(8, 7), base: null }, []).method, undefined)
})

test('which strategy of a starting image comes first is the one the creator took more, on this image model when they picked in it', () => {
  const model = 'nano-banana-2.1'
  const picked = (id, winner, m = model) => ({ ...example(id, 'Some Game', fit(5, 5, 5), winner), model: m, picked: true })
  const current = { game: 'Bake a cake', fit: { ...fit(5, 5, 5), nearestArt: 5, searchArt: 5 }, base: { nearestBase: 8, searchBase: 2 }, refs: { nearest: 'n', search: 's' }, refNames: { nearest: 'Other Game', search: 'Another Game' }, model }
  assert.deepEqual(chooseByPanel(current, []).ranked.slice(0, 2), ['remix', 'template'])
  const metaAndPlain = [picked('a', 'meta'), picked('b', 'meta'), picked('c', 'plain')]
  assert.deepEqual(chooseByPanel(current, metaAndPlain).ranked.slice(0, 2), ['meta', 'plain'])
  assert.equal(chooseByPanel(current, metaAndPlain).learnedFrom, 3)
  // Picks on another model count only until this one has some; judge-only runs never count.
  const elsewhere = [picked('d', 'meta', 'nano-banana-pro'), picked('e', 'meta', 'nano-banana-pro'), { ...example('f', 'Some Game', fit(5, 5, 5), 'meta'), model }]
  assert.deepEqual(chooseByPanel(current, elsewhere).ranked.slice(0, 1), ['meta'])
  assert.deepEqual(chooseByPanel(current, [...elsewhere, picked('g', 'remix')]).ranked.slice(0, 1), ['remix'])
})

test('a run records its panel ratings, and the shipped seed fills them in for runs saved before the panel', () => {
  const scores = [40, 30, 30, 30, 30, 30]
  const withBase = exampleOf(fullRun(scores, { selection: { fit: fit(5, 5, 5), base: { nearestBase: 7, searchBase: 3, bar: 5.5, panel: [] } } }))
  assert.deepEqual(withBase.base, { nearestBase: 7, searchBase: 3 })
  assert.equal(exampleOf(fullRun(scores, { selection: { fit: fit(5, 5, 5) } })).base, null)
  const dir = mkdtempSync(join(tmpdir(), 'panel-seed-'))
  const id = '2026-10-19T06-10-00-000Z-eeeeeeee'
  mkdirSync(join(dir, id))
  writeFileSync(join(dir, id, 'run.json'), JSON.stringify(fullRun(scores, { id, selection: { fit: fit(5, 5, 5) } })))
  const seed = join(dir, 'seed.json')
  writeFileSync(seed, JSON.stringify({ examples: [{ id, game: 'Steal an Egg', fit: fit(5, 5, 5), base: { nearestBase: 6.5, searchBase: 2 }, regret: regret('template') }] }))
  assert.deepEqual(loadExamples(dir, seed).find((e) => e.id === id).base, { nearestBase: 6.5, searchBase: 2 })
})
