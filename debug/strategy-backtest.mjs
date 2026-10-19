// Backtests the strategy selector (server/selector.mjs) on every saved run
// that drew every strategy: leave one run out, pick its strategy from all the
// others, and score the pick by its regret, the judge points it fell short of
// that run's best thumbnail out of 50 (the creator's own pick, when they made
// one, outranks the judge). Runs are scored on the image model the app uses
// now (BACKTEST_MODEL, default the shipped one); runs of other models still
// teach, at the weight the selector gives them. Compares always drawing one
// strategy, the selector, its ablations and the picks the app recorded before
// each explore run's thumbnails existed, overall and by prompt type.
// Usage: node debug/strategy-backtest.mjs [--rate] [--write-seed]
//   --rate        rate the references of explore runs that have no ratings yet (one vision call each)
//   --write-seed  save every example to server/selector-seed.json, the examples the app ships with
// Writes debug/strategy-backtest_report.json.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnv } from '../server/env.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(root)
const { ARMS, DEFAULT_PARAMS, expectedRegrets, loadExamples, modelOf, promptType, refNamesOf, refsOf, regretsOf } = await import('../server/selector.mjs')
const { imageModel } = await import('../server/imagemodels.mjs')
const args = new Set(process.argv.slice(2))
const outputsDir = join(root, 'outputs')
const seedFile = join(root, 'server', 'selector-seed.json')
const MODEL = process.env.BACKTEST_MODEL || imageModel().key

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Explore runs saved before the app recorded ratings: rated now from their saved reference images. */
async function rateMissing(known) {
  const { rateReferences } = await import('../server/fit.mjs')
  const image = (dir, file, name) => (existsSync(join(dir, file)) ? { name, mimeType: 'image/png', bytes: readFileSync(join(dir, file)) } : null)
  const added = []
  let i = 0
  const pending = readdirSync(outputsDir)
    .filter((id) => !known.has(id) && existsSync(join(outputsDir, id, 'run.json')))
    .map((id) => ({ id, dir: join(outputsDir, id), run: JSON.parse(readFileSync(join(outputsDir, id, 'run.json'), 'utf8')) }))
    .filter(({ run }) => (run.mode ?? 'standard') === 'standard' && regretsOf(run))
  await Promise.all(
    pending.map(async ({ id, dir, run }) => {
      await delay(2500 * i++)
      try {
        const fit = await rateReferences(run.gameName, {
          nearest: image(dir, 'reference.png', run.reference?.name),
          search: image(dir, 'search-reference.png', run.searchReference?.name)
        })
        added.push({ id, game: run.gameName, fit, refs: refsOf(run), refNames: refNamesOf(run), model: modelOf(run), regret: regretsOf(run) })
        console.log(`rated ${run.gameName}: nearest ${fit.nearestFit}, search ${fit.searchFit}, clarity ${fit.nameClarity}`)
      } catch (err) {
        console.error(`Rating the references of ${id} failed:`, err)
      }
    })
  )
  return added
}

let examples = loadExamples(outputsDir, seedFile)
if (args.has('--rate')) examples = [...examples, ...(await rateMissing(new Set(examples.map((e) => e.id))))]
examples.sort((a, b) => a.id.localeCompare(b.id))
if (args.has('--write-seed')) {
  const about =
    "Explore runs (every strategy drawn and judged) the strategy selector learns from: each strategy's regret against the run's best thumbnail (or the creator's own pick), out of 50, the reference ratings from server/fit.mjs, the reference games and the image model. The app reads saved runs fresh; these fill in runs a machine does not have. Written by debug/strategy-backtest.mjs --write-seed."
  const shipped = examples.map(({ id, game, fit, refs, refNames, model, regret }) => ({
    id,
    game,
    fit: { nearestFit: fit.nearestFit, searchFit: fit.searchFit, nameClarity: fit.nameClarity },
    refs,
    refNames,
    model,
    regret: Object.fromEntries(ARMS.map((a) => [a, Math.round(regret[a] * 10) / 10]))
  }))
  writeFileSync(seedFile, `${JSON.stringify({ about, examples: shipped }, null, 1)}\n`)
  console.log(`wrote ${examples.length} examples to server/selector-seed.json`)
}

const pick = (expected) => ARMS.reduce((best, a) => (expected[a] < expected[best] ? a : best), 'meta')
const meanOf = (values) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : NaN)
const heldOut = examples.map((e, i) => ({ e, i })).filter(({ e }) => e.model === MODEL)

function typeName(e) {
  const { match, descriptive } = promptType(e)
  if (match === 'exact') return 'the game exists (exact name)'
  return `${match === 'near' ? 'partly matched' : 'no match'}, ${descriptive ? 'description' : 'short name'}`
}

/** Leave-one-out over the held-out runs: (heldOut, rest) => arm, scored by that run's regret. */
function loo(policy) {
  return heldOut.map(({ e, i }) => {
    const rest = examples.filter((_, j) => j !== i)
    const arm = policy(e, rest)
    return { id: e.id, game: e.game, type: typeName(e), arm, regret: e.regret[arm] }
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
    bestPicked: Math.round((regrets.filter((r) => r === 0).length / rows.length) * 100),
    picks: Object.fromEntries(ARMS.map((a) => [a, rows.filter((r) => r.arm === a).length]).filter(([, n]) => n > 0)),
    rows
  }
}

const withParams = (params) => (held, rest) => pick(expectedRegrets(held, rest, { ...DEFAULT_PARAMS, ...params }))
const results = [
  ...ARMS.map((arm) => summarize(`always ${arm}`, loo(() => arm))),
  summarize('selector (shipped)', loo(withParams({}))),
  summarize('  without the prompt-type prior', loo(withParams({ typed: false }))),
  summarize('  other image models counted fully', loo(withParams({ otherModel: 1 }))),
  summarize('  without memory of like runs', loo(withParams({ prior: 50 }))),
  summarize("oracle (the run's own winner)", heldOut.map(({ e }) => ({ id: e.id, game: e.game, type: typeName(e), arm: pick(e.regret), regret: 0 })))
]

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
    `${r.policy.padEnd(38)} mean regret ${r.meanRegret.toFixed(2).padStart(5)}  95% CI ${r.ci95[0].toFixed(2)} to ${r.ci95[1].toFixed(2)}  best pick ${String(r.bestPicked).padStart(3)}%  within 2 pts ${String(r.within2).padStart(3)}%  picks ${JSON.stringify(r.picks)}`
  )
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

console.log('\nselector picks, leave-one-out:')
for (const r of shipped.rows) console.log(`  ${r.game.slice(0, 36).padEnd(36)} ${r.type.padEnd(32)} ${r.arm.padEnd(8)} regret ${r.regret.toFixed(1)}`)

writeFileSync(
  join(root, 'debug', 'strategy-backtest_report.json'),
  `${JSON.stringify({ ranAt: new Date().toISOString(), model: MODEL, examples: examples.length, scored: heldOut.length, params: DEFAULT_PARAMS, results, prospective }, null, 1)}\n`
)
