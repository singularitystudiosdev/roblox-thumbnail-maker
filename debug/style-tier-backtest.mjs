// Backtests, on saved explore runs only (no new images), what the second thumbnail should be when the panel
// picker (server/selector.mjs chooseByPanel) finds no Roblox reference above the bar and falls back to the
// style tier, which draws the two style strategies (template and plain) from the one style image.
// Leave one run out: the picker sees every other run, then three policies are scored on the held-out run:
//   style pair   template + plain (what ships)
//   best ref     the style tier's first strategy + the best-rated reference's first strategy, even below the bar
//   one only     the style tier's first strategy alone (one image instead of two)
// A policy hits when it draws a strategy the creator took (their pick outranks the judge); regret is the judge
// points its best thumbnail fell short of that run's best. Runs the creator never picked count by regret only.
// Usage: node debug/style-tier-backtest.mjs   Writes debug/style-tier-backtest_report.json.
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { ARMS, DEFAULT_PARAMS, chooseByPanel, loadExamples } = await import('../server/selector.mjs')
const outputsDir = join(root, 'outputs')
if (!existsSync(outputsDir)) {
  console.error(`No outputs/ folder at ${outputsDir}: this backtest replays the saved runs there, so run it on the machine that made them.`)
  process.exit(1)
}

const examples = loadExamples(outputsDir, join(root, 'server', 'selector-seed.json'))
const complete = examples.filter((e) => e.base && ARMS.every((a) => Number.isFinite(e.regret?.[a])))
/** The best-rated reference the picker may draw from at all (flat 2D art or none found never), as its first strategy. */
function bestReferenceArm(e, ranked) {
  const flat = (art) => art != null && art <= DEFAULT_PARAMS.flatArt
  const nearest = e.base.nearestBase == null || flat(e.fit?.nearestArt) ? -Infinity : e.base.nearestBase
  const search = e.base.searchBase == null || flat(e.fit?.searchArt) ? -Infinity : e.base.searchBase
  if (nearest === -Infinity && search === -Infinity) return null
  return search > nearest ? 'search' : ranked.find((a) => a === 'remix' || a === 'meta')
}

const policies = {
  'style pair': (drawn) => drawn,
  'best ref': (drawn, e, ranked) => [drawn[0], bestReferenceArm(e, ranked)],
  'one only': (drawn) => [drawn[0]]
}

const rows = []
for (const e of complete) {
  const others = examples.filter((x) => x.id !== e.id)
  const { ranked } = chooseByPanel(e, others, DEFAULT_PARAMS)
  const drawn = ranked.slice(0, 2)
  if (!(drawn.includes('template') && drawn.includes('plain'))) continue
  const scored = Object.fromEntries(
    Object.entries(policies).map(([name, draw]) => {
      const arms = draw(drawn, e, ranked).filter(Boolean)
      return [name, { arms, hit: e.picked ? arms.some((a) => e.regret[a] === 0) : null, regret: Math.min(...arms.map((a) => e.regret[a])) }]
    })
  )
  const taken = e.picked ? ARMS.filter((a) => e.regret[a] === 0) : []
  rows.push({ id: e.id, game: e.game, model: e.model, picked: e.picked, taken, base: e.base, bar: DEFAULT_PARAMS.baseBar, ranked, scored })
  console.log(
    `${e.id.slice(0, 19)} ${String(e.game).slice(0, 34).padEnd(34)} ${e.model ?? '?'} base ${JSON.stringify(e.base)} ${e.picked ? `took ${taken.join('|')}` : 'judge only'}\n  ` +
      Object.entries(scored)
        .map(([name, s]) => `${name}: ${s.arms.join('+')} ${s.hit == null ? '' : s.hit ? 'HIT ' : 'miss '}regret ${s.regret}`)
        .join(' | ')
  )
}

const mean = (values) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null)
const summary = {}
for (const [label, set] of [
  ['picked runs', rows.filter((r) => r.picked)],
  ['picked runs, current image model', rows.filter((r) => r.picked && r.model === 'nano-banana-2.1')],
  ['all style-tier runs (regret only)', rows]
]) {
  summary[label] = Object.fromEntries(
    Object.keys(policies).map((name) => [
      name,
      { runs: set.length, hits: set[0]?.picked ? set.filter((r) => r.scored[name].hit).length : null, meanRegret: mean(set.map((r) => r.scored[name].regret)) }
    ])
  )
  console.log(`\n${label} (${set.length}):`)
  for (const [name, s] of Object.entries(summary[label])) console.log(`  ${name.padEnd(10)} ${s.hits == null ? '' : `${s.hits}/${s.runs} hit, `}mean regret ${s.meanRegret}`)
}

writeFileSync(join(root, 'debug', 'style-tier-backtest_report.json'), JSON.stringify({ at: new Date().toISOString(), params: DEFAULT_PARAMS, rows, summary }, null, 2))
