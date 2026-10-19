// Backtests the strategy selector (server/selector.mjs) on every saved run
// that drew every strategy: leave one run out, pick its strategy from all the
// others, and score the pick by its regret, the judge points it fell short of
// that run's best thumbnail out of 50 (the creator's own pick, when they made
// one, outranks the judge). Runs are scored on the image model the app uses
// now (BACKTEST_MODEL, default the shipped one); runs of other models still
// teach, at the weight the selector gives them. Compares always drawing one
// strategy, the selector, its ablations and the picks the app recorded before
// each explore run's thumbnails existed, overall and by prompt type.
// Usage: node debug/strategy-backtest.mjs [--rate] [--refresh] [--write-seed]
//   --rate        rate, from the saved reference images, the explore runs that lack ratings or request
//                 features (one vision call each, 4 s apart; rewrites the seed after each)
//   --refresh     the same, for every explore run, replacing the features already rated
//   --write-seed  save every example to server/selector-seed.json, the examples the app ships with
//   --quick       skip the request-feature sets and their permutation tests (the slow part, over 20 minutes at 32 runs)
// Writes debug/strategy-backtest_report.json.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnv } from '../server/env.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(root)
const { ARMS, DEFAULT_PARAMS, builtOnExact, coWinners, drawNoise, expectedRegrets, loadExamples, matchLevel, modelOf, nameTokens, promptType, refNamesOf, refsOf, regretsOf } = await import('../server/selector.mjs')
const { imageModel } = await import('../server/imagemodels.mjs')
const { FIT_FEATURES, hasFeatures } = await import('../server/fit.mjs')
const args = new Set(process.argv.slice(2))
const outputsDir = join(root, 'outputs')
const seedFile = join(root, 'server', 'selector-seed.json')
const MODEL = process.env.BACKTEST_MODEL || imageModel().key

const meanOf = (values) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : NaN)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const FIT_KEYS = ['nearestFit', 'searchFit', 'nameClarity']

/** What the seed keeps of a rating: the three fit scores and, once rated, the request features. */
const shippedFit = (fit) => {
  const kept = Object.fromEntries(FIT_KEYS.map((k) => [k, fit[k]]))
  for (const key of FIT_FEATURES) if (fit[key] !== undefined) kept[key] = fit[key]
  return kept
}

function writeSeed(examples) {
  const about =
    "Explore runs (every strategy drawn and judged) the strategy selector learns from: each strategy's regret against the run's best thumbnail (or the creator's own pick), out of 50, the reference ratings and request features from server/fit.mjs, the reference games and the image model. The app reads saved runs fresh; these fill in runs a machine does not have and carry the features rated after a run was saved. Written by debug/strategy-backtest.mjs --write-seed."
  const shipped = examples.map(({ id, game, fit, refs, refNames, model, regret, drawn, picked }) => ({
    id,
    game,
    fit: shippedFit(fit),
    refs,
    refNames,
    model,
    regret: Object.fromEntries(ARMS.map((a) => [a, Math.round(regret[a] * 10) / 10])),
    drawn,
    picked
  }))
  writeFileSync(seedFile, `${JSON.stringify({ about, examples: shipped }, null, 1)}\n`)
  console.log(`wrote ${examples.length} examples to server/selector-seed.json`)
}

/**
 * Rates the references of explore runs from their saved reference images, one vision call at a time.
 * A run with no ratings gets all of them. A run rated before the request features existed keeps its
 * three fit scores (what its recorded pick used) and gains the features from the same call the app
 * makes; the fresh fit scores are only compared with the old ones, as a check on the rater's noise.
 * --refresh rates again every run, replacing the features. The seed is rewritten after each rating, so a
 * lock or a rate limit costs only the runs not yet rated. Two failures in a row stop the run.
 */
async function rateExamples(examples, { refresh }) {
  const { rateReferences } = await import('../server/fit.mjs')
  const image = (dir, file, ref) => (ref?.source === 'roblox' && existsSync(join(dir, file)) ? { name: ref.name, mimeType: 'image/png', bytes: readFileSync(join(dir, file)) } : null)
  const known = new Map(examples.map((e) => [e.id, e]))
  const pending = readdirSync(outputsDir)
    .filter((id) => existsSync(join(outputsDir, id, 'run.json')))
    .map((id) => ({ id, dir: join(outputsDir, id), run: JSON.parse(readFileSync(join(outputsDir, id, 'run.json'), 'utf8')) }))
    .filter(({ run }) => (run.mode ?? 'standard') === 'standard' && regretsOf(run))
    .filter(({ id }) => refresh || !known.has(id) || !hasFeatures(known.get(id).fit))
  const drift = []
  let failures = 0
  for (const { id, dir, run } of pending) {
    if (failures >= 2) {
      console.error('Two ratings failed in a row; stopping. Re-run the same command once the cause is fixed (it resumes where it stopped).')
      break
    }
    try {
      const fit = await rateReferences(run.gameName, { nearest: image(dir, 'reference.png', run.reference), search: image(dir, 'search-reference.png', run.searchReference) })
      const old = known.get(id)
      if (old) {
        for (const k of FIT_KEYS) if (old.fit[k] != null && fit[k] != null) drift.push(Math.abs(old.fit[k] - fit[k]))
        for (const key of FIT_FEATURES) old.fit[key] = fit[key]
      } else {
        const example = { id, game: run.gameName, fit, refs: refsOf(run), refNames: refNamesOf(run), model: modelOf(run), regret: regretsOf(run) }
        known.set(id, example)
        examples.push(example)
      }
      failures = 0
      console.log(`rated ${run.gameName}: fit ${fit.nearestFit}/${fit.searchFit}, clarity ${fit.nameClarity}, ${fit.genre}, realism ${fit.realism}, abstract ${fit.abstractness}, known ${fit.knownGame}, art ${fit.nearestArt}/${fit.searchArt}`)
      examples.sort((a, b) => a.id.localeCompare(b.id))
      writeSeed(examples)
    } catch (err) {
      failures++
      console.error(`Rating the references of ${id} failed:`, err)
    }
    await delay(4000)
  }
  if (drift.length > 0) console.log(`fresh fit scores vs the recorded ones: mean absolute difference ${meanOf(drift).toFixed(2)} points on 1 to 10 (${drift.length} scores)`)
}

let examples = loadExamples(outputsDir, seedFile)
if (args.has('--rate') || args.has('--refresh')) await rateExamples(examples, { refresh: args.has('--refresh') })
examples.sort((a, b) => a.id.localeCompare(b.id))
if (args.has('--write-seed')) writeSeed(examples)

const nameTokensOf = (e) => nameTokens(e.game).length
const pick = (expected) => ARMS.reduce((best, a) => (expected[a] < expected[best] ? a : best), 'meta')
const heldOut = examples.map((e, i) => ({ e, i })).filter(({ e }) => e.model === MODEL)

function typeName(e) {
  const { match, descriptive } = promptType(e)
  if (match === 'exact') return 'the game exists (exact name)'
  return `${match === 'near' ? 'partly matched' : 'no match'}, ${descriptive ? 'description' : 'short name'}`
}

// Noise between two draws of the same strategy, measured on the runs of the shipped image model.
const SIGMA = drawNoise(
  heldOut.map(({ e }) => JSON.parse(readFileSync(join(outputsDir, e.id, 'run.json'), 'utf8')))
)

/** How a pick scores in a run: its regret, whether it IS the winning strategy (strict, ties count), and whether it is one the judge cannot tell from the best. */
function outcome(e, arm) {
  const best = Math.min(...ARMS.map((a) => e.regret[a]))
  return { arm, regret: e.regret[arm], hit: e.regret[arm] <= best + 1e-9, coHit: coWinners(e, SIGMA).includes(arm) }
}

/** Leave-one-out over the held-out runs: (heldOut, rest) => arm, scored by that run's regret. */
function loo(policy) {
  return heldOut.map(({ e, i }) => {
    const rest = examples.filter((_, j) => j !== i)
    return { id: e.id, game: e.game, type: typeName(e), ...outcome(e, policy(e, rest)) }
  })
}

function bootstrapMean(values, draws = 4000) {
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const means = Array.from({ length: draws }, () => meanOf(values.map(() => values[Math.floor(random() * values.length)]))).sort((a, b) => a - b)
  return [means[Math.floor(draws * 0.025)], means[Math.floor(draws * 0.975)]]
}

const round = (v) => Math.round(v * 100) / 100

function summarize(name, rows) {
  const regrets = rows.map((r) => r.regret)
  const [low, high] = bootstrapMean(regrets)
  return {
    policy: name,
    meanRegret: round(meanOf(regrets)),
    ci95: [round(low), round(high)],
    within2: Math.round((regrets.filter((r) => r <= 2).length / rows.length) * 100),
    winnerPicked: Math.round((rows.filter((r) => r.hit).length / rows.length) * 100),
    noiseAware: Math.round((rows.filter((r) => r.coHit).length / rows.length) * 100),
    picks: Object.fromEntries(ARMS.map((a) => [a, rows.filter((r) => r.arm === a).length]).filter(([, n]) => n > 0)),
    rows
  }
}

const withParams = (params) => (held, rest) => pick(expectedRegrets(held, rest, { ...DEFAULT_PARAMS, ...params }))
const results = [
  ...ARMS.map((arm) => summarize(`always ${arm}`, loo(() => arm))),
  summarize('selector (shipped)', loo(withParams({}))),
  summarize('  without the prompt-type prior', loo(withParams({ typed: false }))),
  summarize('  other image models counted 0.25 (before)', loo(withParams({ otherModel: 0.25 }))),
  summarize('  other image models counted fully', loo(withParams({ otherModel: 1 }))),
  summarize('  without memory of like runs', loo(withParams({ prior: 50 }))),
  summarize("oracle (the run's own winner)", heldOut.map(({ e }) => ({ id: e.id, game: e.game, type: typeName(e), ...outcome(e, pick(e.regret)) })))
]

// The 80% target: how often the pick IS the winning strategy. "Winner picked" is strict: the pick has the lowest regret
// of the five (a tie counts; the creator's own pick decides where they made one). "Noise-aware" also counts a pick the
// judge cannot tell from the best at 1.96 standard errors (coWinners, selector.mjs), given the draw-to-draw noise
// measured on these runs (SIGMA). Strict is the number to hold the target to; noise-aware only says how much of the rest is noise.
// Every approach below is scored leave-one-out; anything tuned is tuned inside each fold (nested). The two marked
// "after reading the data" were written once the winners were known, so their scores are optimistic.
const featureRow = (e, names) => {
  const level = (w) => matchLevel(e.game, e.refNames?.[w])
  const all = {
    exactN: +(level('nearest') === 'exact'), exactS: +(level('search') === 'exact'), nearN: +(level('nearest') === 'near'), nearS: +(level('search') === 'near'),
    desc: +(nameTokens(e.game).length >= 3), words: Math.min(8, nameTokens(e.game).length), fitA: e.fit.nearestFit ?? 5, fitB: e.fit.searchFit ?? 5, clarity: e.fit.nameClarity ?? 5,
    known: e.fit.knownGame ?? 5, realism: e.fit.realism ?? 5, abstract: e.fit.abstractness ?? 5, artA: e.fit.nearestArt ?? 5, artB: e.fit.searchArt ?? 5
  }
  return names.map((n) => all[n])
}
const weightOf = (e) => (e.model === MODEL ? 1 : DEFAULT_PARAMS.otherModel)

/** Weighted ridge regression of each strategy's regret on standardised features; returns e => predicted regret per strategy. */
function ridgeModel(train, names, lambda) {
  const rows = train.map((e) => ({ e, x: featureRow(e, names), w: weightOf(e) }))
  const W = rows.reduce((sum, r) => sum + r.w, 0)
  const mu = names.map((_, j) => rows.reduce((sum, r) => sum + r.w * r.x[j], 0) / W)
  const sd = names.map((_, j) => Math.sqrt(rows.reduce((sum, r) => sum + r.w * (r.x[j] - mu[j]) ** 2, 0) / W) || 1)
  const z = (x) => x.map((v, j) => (v - mu[j]) / sd[j])
  const d = names.length
  const models = Object.fromEntries(
    ARMS.map((arm) => {
      const ybar = rows.reduce((sum, r) => sum + r.w * r.e.regret[arm], 0) / W
      const M = Array.from({ length: d }, (_, i) => [...Array(d).fill(0), 0].map((_, j) => (i === j ? lambda : 0)))
      for (const r of rows) {
        const zr = z(r.x)
        for (let i = 0; i < d; i++) {
          for (let j = 0; j < d; j++) M[i][j] += r.w * zr[i] * zr[j]
          M[i][d] += r.w * zr[i] * (r.e.regret[arm] - ybar)
        }
      }
      for (let i = 0; i < d; i++) {
        let p = i
        for (let r = i + 1; r < d; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r
        ;[M[i], M[p]] = [M[p], M[i]]
        for (let r = 0; r < d; r++) {
          if (r === i) continue
          const f = M[r][i] / M[i][i]
          for (let c = i; c <= d; c++) M[r][c] -= f * M[i][c]
        }
      }
      return [arm, { ybar, beta: M.map((row, i) => row[d] / row[i]) }]
    })
  )
  return (e) => {
    const ze = z(featureRow(e, names))
    return Object.fromEntries(ARMS.map((arm) => [arm, models[arm].ybar + models[arm].beta.reduce((sum, b, j) => sum + b * ze[j], 0)]))
  }
}

/** A policy whose one knob is chosen per fold by leave-one-out regret on the other runs: make(knob) => (held, rest) => arm. */
const nestedKnob = (knobs, make) => (held, rest) => {
  const inner = rest.filter((r) => r.model === MODEL)
  let best = null
  for (const knob of knobs) {
    const score = meanOf(inner.map((h) => h.regret[make(knob)(h, rest.filter((r) => r.id !== h.id))]))
    if (!best || score < best.score - 1e-9) best = { knob, score }
  }
  return make(best.knob)(held, rest)
}

// A cell table: the prompt's type (exact name on the nearest game, on the search game, a description, a short name), each
// cell's strategy the one with the lowest regret in past runs of that cell, shrunk toward all runs.
const cellOf = (e) => {
  const f = featureRow(e, ['exactN', 'exactS', 'desc'])
  return f[0] ? 'nearest-exact' : f[1] ? 'search-exact' : f[2] ? 'description' : 'short'
}
const cellTable = (held, rest) => {
  const same = rest.filter((r) => cellOf(r) === cellOf(held))
  const total = rest.reduce((sum, r) => sum + weightOf(r), 0)
  const weight = same.reduce((sum, r) => sum + weightOf(r), 0)
  return pick(Object.fromEntries(ARMS.map((a) => [a, (same.reduce((sum, r) => sum + weightOf(r) * r.regret[a], 0) + 2 * (rest.reduce((sum, r) => sum + weightOf(r) * r.regret[a], 0) / total)) / (weight + 2)])))
}
const hardRule = (held) => ({ 'nearest-exact': 'remix', 'search-exact': 'search', description: 'plain', short: 'template' })[cellOf(held)]
const ridgePolicy = (names) => nestedKnob([1, 3, 10, 30, 100, 1000], (lambda) => (held, rest) => pick(ridgeModel(rest, names, lambda)(held)))

const approaches = [
  summarize('selector before this change (no exact bonus)', loo(withParams({ exactBonus: 0 }))),
  summarize('selector shipped (exact bonus 3)', loo(withParams({}))),
  summarize('exact bonus chosen per fold (nested)', loo(nestedKnob([0, 1, 2, 3, 5, 8, 20], (exactBonus) => withParams({ exactBonus })))),
  summarize('cell table learned (4 cells)', loo(cellTable)),
  summarize('ridge on name match + length (nested)', loo(ridgePolicy(['exactN', 'exactS', 'nearN', 'nearS', 'desc']))),
  summarize('ridge + fit ratings, clarity (nested)', loo(ridgePolicy(['exactN', 'exactS', 'nearN', 'nearS', 'desc', 'fitA', 'fitB', 'clarity']))),
  summarize('ridge on every feature (nested)', loo(ridgePolicy(['exactN', 'exactS', 'nearN', 'nearS', 'desc', 'words', 'fitA', 'fitB', 'clarity', 'known', 'realism', 'abstract', 'artA', 'artB']))),
  summarize('ridge on model ratings only (no name match)', loo(ridgePolicy(['desc', 'words', 'fitA', 'fitB', 'clarity', 'known', 'realism', 'abstract', 'artA', 'artB']))),
  summarize('hard rule, after reading the data (optimistic)', loo(hardRule))
]

// What a perfect predictor could score: it knows each strategy's expected score exactly (taken as the observed mean),
// and is judged against the winner of a fresh run, each draw SIGMA points of noise (a strategy drawn n times: SIGMA over sqrt n).
function ceiling(reps = 400) {
  let seed = 11
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const gauss = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random())
  let hits = 0
  let total = 0
  for (const { e } of heldOut) {
    const run = JSON.parse(readFileSync(join(outputsDir, e.id, 'run.json'), 'utf8'))
    const mu = Object.fromEntries(ARMS.map((a) => [a, meanOf(run.slots.filter((s) => s.strategy === a).map((s) => run.judge.scores.find((x) => x.slot === s.slot)).filter(Boolean).map((x) => Number(x.total)))]))
    const n = Object.fromEntries(ARMS.map((a) => [a, Math.max(1, e.drawn?.[a] ?? 1)]))
    const top = ARMS.reduce((b, a) => (mu[a] > mu[b] ? a : b))
    for (let k = 0; k < reps; k++) {
      const fresh = ARMS.reduce((b, a) => (mu[a] + (gauss() * SIGMA) / Math.sqrt(n[a]) > mu[b] + (gauss() * SIGMA) / Math.sqrt(n[b]) ? a : b))
      total++
      if (fresh === top) hits++
    }
  }
  return Math.round((hits / total) * 100)
}
const ceilingPct = ceiling()

// Learning curve: the shipped selector trained on n of the other runs of the shipped model (and all runs of the other models).
function learningCurve(sizes, reps = 60) {
  let seed = 5
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  return sizes.map((size) => {
    let hits = 0
    let regret = 0
    let total = 0
    for (let rep = 0; rep < reps; rep++) {
      for (const { e, i } of heldOut) {
        const rest = examples.filter((_, j) => j !== i)
        const own = rest.filter((r) => r.model === MODEL)
        const others = rest.filter((r) => r.model !== MODEL)
        const chosen = own.map((r) => [random(), r]).sort((a, b) => a[0] - b[0]).slice(0, Math.min(size, own.length)).map(([, r]) => r)
        const o = outcome(e, withParams({})(e, [...others, ...chosen]))
        total++
        if (o.hit) hits++
        regret += o.regret
      }
    }
    return { trainingRuns: Math.min(size, heldOut.length - 1), winnerPicked: Math.round((hits / total) * 100), meanRegret: round(regret / total) }
  })
}
const curve = learningCurve([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30])

// Where the curve is heading: the winner-picked share closes the gap to the perfect predictor's ceiling at a steady rate
// (ln of the gap falls by a fixed amount per run). Fitted over the curve's points; a target at or above the ceiling is never reached.
const projection = (() => {
  const points = curve.filter((c) => c.winnerPicked < ceilingPct - 1).map((c) => [c.trainingRuns, Math.log(ceilingPct - c.winnerPicked)])
  const mx = meanOf(points.map((p) => p[0]))
  const my = meanOf(points.map((p) => p[1]))
  const slope = points.reduce((sum, p) => sum + (p[0] - mx) * (p[1] - my), 0) / points.reduce((sum, p) => sum + (p[0] - mx) ** 2, 0)
  const runsFor = (target) => (target >= ceilingPct ? null : Math.ceil((my - slope * mx - Math.log(ceilingPct - target)) / -slope))
  return Object.fromEntries([60, 70, 75, 80].map((t) => [t, runsFor(t)]))
})()

// Request features: does a feature of the request (or of the reference it starts from) tell which strategy
// wins, beyond the name match the selector already reads? Each set below adds features to the selector's kernel
// (a distance, weight w) or splits its typed prior by them. Scored two ways: the weight fixed at a middle value
// (optimistic: the sets were chosen after looking at this data) and NESTED, where each held-out run's weight
// (or off) is chosen on the other runs alone by their own leave-one-out regret. The nested number is the honest
// one; a set ships only if it beats the shipped selector's mean regret. Examples without ratings for a feature
// count as distance 0 in it, so the sets are only meaningful once every example is rated (`--rate`).
const rated = examples.filter((e) => hasFeatures(e.fit)).length
const kernel = (features, weights = [0.5, 1, 2, 4]) => ({ grid: [{}, ...weights.map((w) => ({ features, featureWeight: w }))], fixed: { features, featureWeight: 1 } })
const split = (features) => ({ grid: [{}, { split: features }], fixed: { split: features } })
const PERMUTATIONS = 100
const FEATURE_SETS = [
  ['name words (plain code)', kernel(['words'])],
  ['realism: real world vs fantasy', kernel(['realism'])],
  ['abstractness', kernel(['abstractness'])],
  ['known game (model)', kernel(['knownGame'])],
  ['reference art style', kernel(['art'])],
  ['genre', kernel(['genre'])],
  ['realism + abstractness', kernel(['realism', 'abstractness'])],
  ['all request features', kernel(['words', 'realism', 'abstractness', 'knownGame', 'art', 'genre'])],
  ['split prior by realism', split(['realism'])],
  ['split prior by abstractness', split(['abstractness'])],
  ['split prior by known game', split(['knownGame'])],
  ['split prior by reference art', split(['art'])],
  // Not features: the selector's own knobs, chosen per fold, to see whether they are over- or under-fitted.
  ['retune memory weight', { grid: [{}, { prior: 4 }, { prior: 16 }, { prior: 50 }], fixed: { prior: 16 } }],
  ['retune other-model weight', { grid: [{}, { otherModel: 0 }, { otherModel: 0.25 }, { otherModel: 0.5 }], fixed: { otherModel: 0.25 } }],
  // The honest figure for the shipped other-model weight (0.1, chosen on all the data): chosen per fold from 0 to 1, ties to the old 0.25.
  ['other-model weight, nested', { grid: [{ otherModel: 0.25 }, { otherModel: 0 }, { otherModel: 0.1 }, { otherModel: 0.5 }, { otherModel: 1 }], fixed: { otherModel: 0.1 } }],
  ['retune both', { grid: [{}, ...[4, 16].flatMap((prior) => [0, 0.25, 0.5].map((otherModel) => ({ prior, otherModel })))], fixed: { prior: 16, otherModel: 0 } }]
]

/** Leave-one-out where the parameter choice for each held-out run is made on the other runs alone. */
function nestedLoo(grid, pool = examples) {
  return pool
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.model === MODEL)
    .map(({ e, i }) => {
      const rest = pool.filter((_, j) => j !== i)
      const inner = rest.map((h, k) => ({ h, k })).filter(({ h }) => h.model === MODEL)
      const score = (extra) => meanOf(inner.map(({ h, k }) => h.regret[pick(expectedRegrets(h, rest.filter((_, j) => j !== k), { ...DEFAULT_PARAMS, ...extra }))]))
      const scores = grid.map(score)
      const best = scores.indexOf(Math.min(...scores))
      const arm = pick(expectedRegrets(e, rest, { ...DEFAULT_PARAMS, ...grid[best] }))
      return { id: e.id, game: e.game, type: typeName(e), ...outcome(e, arm), chose: best === 0 ? 'default' : Object.entries(grid[best]).filter(([k]) => k !== 'features' && k !== 'split').map(([k, v]) => `${k} ${v}`).join(' ') || 'on' }
    })
}

/** The same examples with a feature's ratings dealt out at random among them: what a feature with no real link to the winners scores. */
const FIT_KEYS_OF = { art: ['nearestArt', 'searchArt'], genre: ['genre'], realism: ['realism'], abstractness: ['abstractness'], knownGame: ['knownGame'] }
function shuffled(pool, features, seed) {
  let state = seed
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647
  const order = pool.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return pool.map((e, i) => ({ ...e, fit: { ...e.fit, ...Object.fromEntries(features.flatMap((f) => FIT_KEYS_OF[f] ?? []).map((key) => [key, pool[order[i]].fit[key]])) } }))
}

const baseline = results.find((r) => r.policy === 'selector (shipped)')

// The selector apart on runs the creator picked a winner in and runs only the judge scored. The judge's own leanings
// (its named-game context rewards a close copy of the real game's thumbnail, which the exact-name bonus then learns)
// show up as a gap between the two, so the exact-name bonus is scored on each too.
const noExactBonus = approaches.find((r) => r.policy.startsWith('selector before this change'))
const pickedIds = new Set(examples.filter((e) => e.picked).map((e) => e.id))
const bySource = [['creator picked', true], ['judge only', false]].flatMap(([source, picked]) => {
  const keep = (rows) => rows.filter((row) => pickedIds.has(row.id) === picked)
  if (keep(baseline.rows).length === 0) return []
  return [{ source, n: keep(baseline.rows).length, shipped: summarize(`selector (shipped), ${source}`, keep(baseline.rows)), noExactBonus: summarize(`no exact bonus, ${source}`, keep(noExactBonus.rows)), alwaysPlain: summarize(`always plain, ${source}`, keep(results.find((r) => r.policy === 'always plain').rows)) }]
})

// The judge behind every label the creator did not override: server/judge.mjs at its last commit, and whether the
// working copy differs (runs record no judge version, so a run re-judged since may carry a different one).
const judgeAt = (() => {
  try {
    const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim()
    return { commit: git('log', '-1', '--format=%h', '--', 'server/judge.mjs'), changedSinceCommit: git('status', '--porcelain', '--', 'server/judge.mjs') !== '' }
  } catch (err) {
    console.error('Reading the judge commit failed:', err)
    return null
  }
})()

const featureResults = []
if (!args.has('--quick') && rated >= examples.length * 0.9) {
  for (const [name, { grid, fixed }] of FEATURE_SETS) {
    const fixedRows = loo(withParams(fixed))
    const nestedRows = nestedLoo(grid)
    const diff = nestedRows.map((r, n) => r.regret - baseline.rows[n].regret)
    const [dLow, dHigh] = bootstrapMean(diff)
    // A set that beats the shipped selector might do so by luck, since several were tried: score it again on
    // ratings dealt out at random; the share of those at least as good is its p-value.
    const used = [...(fixed.features ?? []), ...(fixed.split ?? [])].filter((f) => FIT_KEYS_OF[f])
    let permutationP = null
    if (used.length > 0 && meanOf(nestedRows.map((r) => r.regret)) < baseline.meanRegret) {
      const nulls = Array.from({ length: PERMUTATIONS }, (_, n) => meanOf(nestedLoo(grid, shuffled(examples, used, 1000 + n)).map((r) => r.regret)))
      permutationP = round((nulls.filter((v) => v <= meanOf(nestedRows.map((r) => r.regret)) + 1e-9).length + 1) / (PERMUTATIONS + 1))
    }
    featureResults.push({
      permutationP,
      set: name,
      fixed: summarize(`${name} (weight fixed)`, fixedRows),
      nested: summarize(`${name} (nested)`, nestedRows),
      nestedMinusShipped: round(meanOf(diff)),
      nestedMinusShippedCi95: [round(dLow), round(dHigh)],
      chose: nestedRows.reduce((acc, r) => ({ ...acc, [r.chose]: (acc[r.chose] ?? 0) + 1 }), {})
    })
  }
}

// The picks the app itself recorded before each explore run's thumbnails existed: the real held-out test.
const prospective = readdirSync(outputsDir)
  .filter((id) => existsSync(join(outputsDir, id, 'run.json')))
  .map((id) => JSON.parse(readFileSync(join(outputsDir, id, 'run.json'), 'utf8')))
  .filter((run) => run.selection?.explore && regretsOf(run) && modelOf(run) === MODEL)
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((run) => {
    const regret = regretsOf(run)
    const e = { game: run.gameName, refNames: refNamesOf(run) }
    return { id: run.id, game: run.gameName, type: typeName(e), arm: run.selection.arm, regret: regret[run.selection.arm], all: regret }
  })

console.log(`\n${examples.length} explore runs; scored on the ${heldOut.length} drawn with ${MODEL}\n`)
for (const r of results) {
  console.log(
    `${r.policy.padEnd(38)} mean regret ${r.meanRegret.toFixed(2).padStart(5)}  95% CI ${r.ci95[0].toFixed(2)} to ${r.ci95[1].toFixed(2)}  winner picked ${String(r.winnerPicked).padStart(3)}% (noise-aware ${String(r.noiseAware).padStart(3)}%)  within 2 pts ${String(r.within2).padStart(3)}%  picks ${JSON.stringify(r.picks)}`
  )
}

console.log(`\nthe 80% target; noise between two draws of one strategy ${SIGMA.toFixed(2)} points, a perfect predictor of the expected scores would pick the fresh winner ${ceilingPct}% of the time (strict)`)
console.log(`${'approach (leave-one-out)'.padEnd(52)} ${'winner picked'.padEnd(14)} ${'noise-aware'.padEnd(12)} ${'within 2'.padEnd(9)} mean regret (95% CI)`)
for (const r of approaches) console.log(`${r.policy.padEnd(52)} ${(r.winnerPicked + '%').padEnd(14)} ${(r.noiseAware + '%').padEnd(12)} ${(r.within2 + '%').padEnd(9)} ${r.meanRegret.toFixed(2)} (${r.ci95[0].toFixed(2)} to ${r.ci95[1].toFixed(2)})`)
console.log('learning curve of the shipped selector (training runs of the shipped model -> winner picked, mean regret):')
console.log('  ' + curve.map((c) => `${c.trainingRuns}: ${c.winnerPicked}%, ${c.meanRegret.toFixed(2)}`).join('   '))
console.log(`  explore runs of the shipped model needed to reach a strict winner-picked share, from that curve and the ceiling: ${Object.entries(projection).map(([t, n]) => `${t}%: ${n ?? 'never (at or above the ceiling)'}`).join(', ')}`)

if (featureResults.length > 0) {
  console.log(`\nrequest features (${rated} of ${examples.length} examples rated); mean regret, shipped selector ${baseline.meanRegret.toFixed(2)}, always plain ${results.find((r) => r.policy === 'always plain').meanRegret.toFixed(2)}`)
  console.log(`${'feature set'.padEnd(32)} ${'weight fixed (winner/within 2)'.padEnd(34)} ${'nested, honest'.padEnd(34)} nested minus shipped (95% CI)   chose   permutation p`)
  for (const f of featureResults) {
    const cell = (r) => `${r.meanRegret.toFixed(2)} (${r.ci95[0].toFixed(2)} to ${r.ci95[1].toFixed(2)}) ${String(r.winnerPicked).padStart(2)}/${String(r.within2).padStart(3)}%`.padEnd(34)
    console.log(`${f.set.padEnd(32)} ${cell(f.fixed)} ${cell(f.nested)} ${String(f.nestedMinusShipped).padStart(6)} (${f.nestedMinusShippedCi95[0]} to ${f.nestedMinusShippedCi95[1]})   ${JSON.stringify(f.chose)}${f.permutationP != null ? `   p=${f.permutationP}` : ''}`)
  }
} else if (args.has('--quick')) {
  console.log('\nrequest features: skipped (--quick)')
} else {
  console.log(`\nrequest features: only ${rated} of ${examples.length} examples are rated; run \`node debug/strategy-backtest.mjs --rate\` first`)
}

// Which request features matter: for each, the runs split into a low and a high band (genre: one band per genre),
// with how each strategy fared in the band (mean regret; lower is better) and what the shipped selector scored there.
const BANDS = [
  ['realism (fantasy 1 to 5, real world 6 to 10)', (f) => f.realism, 'realism'],
  ['abstractness (concrete 1 to 5, abstract 6 to 10)', (f) => f.abstractness, 'abstractness'],
  ['known game (not 1 to 5, is 6 to 10)', (f) => f.knownGame, 'knownGame'],
  ['name clarity (vague 1 to 5, clear 6 to 10)', (f) => f.nameClarity, 'nameClarity'],
  ["nearest game's art (flat/blocky 1 to 5, realistic 6 to 10)", (f) => f.nearestArt, 'nearestArt'],
  ["search game's art (flat/blocky 1 to 5, realistic 6 to 10)", (f) => f.searchArt, 'searchArt']
]
const featureBreakdown = []
{
  const loRows = new Map(baseline.rows.map((r) => [r.id, r]))
  const section = (feature, label, groups) => {
    for (const [band, members] of groups) {
      if (members.length === 0) continue
      featureBreakdown.push({
        feature,
        band: `${label}: ${band}`,
        n: members.length,
        meanRegretByStrategy: Object.fromEntries(ARMS.map((a) => [a, round(meanOf(members.map((e) => e.regret[a])))])),
        winners: Object.fromEntries(ARMS.map((a) => [a, members.filter((e) => pick(e.regret) === a).length]).filter(([, n]) => n > 0)),
        shippedSelector: round(meanOf(members.map((e) => loRows.get(e.id).regret)))
      })
    }
  }
  const scored = heldOut.map(({ e }) => e)
  for (const [label, get, feature] of BANDS) section(feature, label, [['low', scored.filter((e) => get(e.fit) != null && get(e.fit) <= 5)], ['high', scored.filter((e) => get(e.fit) != null && get(e.fit) >= 6)]])
  section('genre', 'genre', [...new Set(scored.map((e) => e.fit.genre))].map((g) => [g, scored.filter((e) => e.fit.genre === g)]))
  section('words', 'words in the name', [['1 to 2', scored.filter((e) => nameTokensOf(e) <= 2)], ['3 or more', scored.filter((e) => nameTokensOf(e) >= 3)]])
}
if (featureBreakdown.length > 0) {
  console.log('\nby request feature, runs of the shipped image model: mean regret of always drawing each strategy in the band (lower is better), the shipped selector, and how often each strategy won')
  console.log(`${'band'.padEnd(66)} n  ${ARMS.map((a) => a.padStart(8)).join('')}  selector  winners`)
  for (const b of featureBreakdown) console.log(`${b.band.slice(0, 65).padEnd(66)} ${String(b.n).padStart(2)} ${ARMS.map((a) => b.meanRegretByStrategy[a].toFixed(1).padStart(8)).join('')}  ${b.shippedSelector.toFixed(1).padStart(8)}  ${JSON.stringify(b.winners)}`)
}

const shipped = results.find((r) => r.policy === 'selector (shipped)')
const byType = {}
for (const row of shipped.rows) (byType[row.type] ??= []).push(row)
console.log('\nby prompt type (selector leave-one-out vs always plain, always template):')
for (const [type, rows] of Object.entries(byType)) {
  const ids = new Set(rows.map((r) => r.id))
  const constant = (arm) => meanOf(heldOut.filter(({ e }) => ids.has(e.id)).map(({ e }) => e.regret[arm]))
  console.log(`  ${type.padEnd(32)} n=${rows.length}  selector ${meanOf(rows.map((r) => r.regret)).toFixed(2)}  plain ${constant('plain').toFixed(2)}  template ${constant('template').toFixed(2)}`)
}

if (prospective.length > 0) {
  const constant = (arm) => meanOf(prospective.map((p) => p.all[arm]))
  console.log(
    `\nrecorded picks on ${prospective.length} explore runs (made before any thumbnail existed): mean regret ${meanOf(prospective.map((p) => p.regret)).toFixed(2)}; always plain ${constant('plain').toFixed(2)}, template ${constant('template').toFixed(2)}, meta ${constant('meta').toFixed(2)}`
  )
  for (const p of prospective) console.log(`  ${p.game.slice(0, 36).padEnd(36)} ${p.type.padEnd(32)} picked ${p.arm.padEnd(8)} regret ${p.regret.toFixed(1)}`)
}

console.log(`\nby who chose the winner (judge ${judgeAt ? `${judgeAt.commit}${judgeAt.changedSinceCommit ? ', changed since' : ''}` : 'unknown'}): winner picked, within 2, mean regret`)
for (const s of bySource) {
  const cell = (r) => `${String(r.winnerPicked).padStart(3)}% ${String(r.within2).padStart(3)}% ${r.meanRegret.toFixed(2)}`
  console.log(`  ${s.source.padEnd(16)} n=${String(s.n).padStart(2)}  selector ${cell(s.shipped)}   no exact bonus ${cell(s.noExactBonus)}   always plain ${cell(s.alwaysPlain)}`)
}

console.log('\nselector picks, leave-one-out:')
for (const r of shipped.rows) console.log(`  ${r.game.slice(0, 36).padEnd(36)} ${r.type.padEnd(32)} ${r.arm.padEnd(8)} regret ${r.regret.toFixed(1)}`)

writeFileSync(
  join(root, 'debug', 'strategy-backtest_report.json'),
  `${JSON.stringify({ ranAt: new Date().toISOString(), model: MODEL, judge: judgeAt, examples: examples.length, scored: heldOut.length, params: DEFAULT_PARAMS, results, approaches, bySource, ceilingPct, sigma: round(SIGMA), curve, projection, featureResults, featureBreakdown, prospective }, null, 1)}\n`
)
