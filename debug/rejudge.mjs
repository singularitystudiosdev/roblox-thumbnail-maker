// Re-judges saved runs many times to measure how consistently the judge picks
// the expected winner. Mirrors production: same judge module, same inputs a run
// gives it (its thumbnails, plus its game context when the judge takes one).
// Usage: node debug/rejudge.mjs [trials] [<runId>=<expectedSlot>[|<slot>] ...]
// With no sets given it re-judges every pick: each set in debug/labels.json plus
// every outputs/*/run.json carrying a `userPick` (the creator's winner pick made in
// the UI; accept = userPick.accept when it has one, else [userPick.slot]), deduplicated by run id. A userPick run with no labels.json
// entry counts as held out. It totals the sets the judge was tuned on apart from the
// held-out ones. Change the judge only after running it this way.
// Writes debug/rejudge_report.json with one entry per trial. A trial that errors, or that fal
// refused so a fallback model answered, is retried (up to 3 attempts) and never counted as a miss.
// The summary at the end is computed here, never by hand: agreement (picks whose every trial
// agrees, and trials that agree), split held out vs tuned on, and on every miss the mean judge
// points between the winner and the creator's best-scored accepted slot.
// Re-print the summary of a saved report without judging: node debug/rejudge.mjs --summarize [report.json]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadDotEnv } from '../server/env.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(root)
// A candidate judge module to try instead of the shipped one: JUDGE_MODULE=/abs/path/judge-candidate.mjs
const judge = await import(process.env.JUDGE_MODULE ? pathToFileURL(process.env.JUDGE_MODULE).href : '../server/judge.mjs')
// A candidate rubric to try instead of the shipped one: JUDGE_SYSTEM_FILE=/path/to/rubric.txt
const system = process.env.JUDGE_SYSTEM_FILE ? readFileSync(process.env.JUDGE_SYSTEM_FILE, 'utf8') : undefined

/** The agreement summary of a report, printed and returned: totals per group plus the miss gap. */
function summarize(report) {
  const judged = report.cases.filter((c) => !c.skipped)
  const out = {}
  for (const [key, label, sets] of [
    ['inSample', 'tuned on (in-sample)', judged.filter((c) => c.tunedOn)],
    ['heldOut', 'held out', judged.filter((c) => !c.tunedOn)],
    ['all', 'all picks', judged]
  ]) {
    if (sets.length === 0) continue
    const counted = (c) => c.rows.filter((r) => r.winnerSlot != null)
    const trialsRun = sets.reduce((n, c) => n + counted(c).length, 0)
    const passedTrials = sets.reduce((n, c) => n + counted(c).filter((r) => r.pass).length, 0)
    const setsAll = sets.filter((c) => counted(c).length > 0 && counted(c).every((r) => r.pass)).length
    const gaps = sets.flatMap((c) =>
      counted(c)
        .filter((r) => !r.pass)
        .map((r) => (r.totals[r.winnerSlot] ?? 0) - Math.max(...c.accepted.map((slot) => r.totals[slot] ?? 0)))
    )
    const missGap = gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null
    console.log(`\n${label}: ${setsAll}/${sets.length} picks agreed on every trial, ${passedTrials}/${trialsRun} trials agreed${missGap == null ? '' : `, mean gap on misses ${missGap} of ${judge.MAX_TOTAL ?? 50} points (winner total minus the creator's pick total)`}`)
    out[key] = { sets: sets.length, setsAllTrials: setsAll, trials: trialsRun, passedTrials, meanMissGap: missGap }
  }
  return out
}

const [trialsArg, ...given] = process.argv.slice(2)
if (trialsArg === '--summarize') {
  summarize(JSON.parse(readFileSync(given[0] ?? join(root, 'debug', 'rejudge_report.json'), 'utf8')))
  process.exit(0)
}
const trials = Number(trialsArg) || 5
const labels = JSON.parse(readFileSync(join(root, 'debug', 'labels.json'), 'utf8')).labels

/** Runs the creator picked a winner for in the UI: outputs/<run>/run.json with a userPick. */
function userPickedRuns() {
  const outputs = join(root, 'outputs')
  if (!existsSync(outputs)) return []
  const picked = []
  for (const id of readdirSync(outputs).sort()) {
    const file = join(outputs, id, 'run.json')
    if (!existsSync(file)) continue
    try {
      const run = JSON.parse(readFileSync(file, 'utf8'))
      const pick = run.userPick
      // accept: every slot the creator takes as the winner; a plain pick is just its slot.
      const accept = Array.isArray(pick?.accept) && pick.accept.length > 0 ? pick.accept.map(Number) : Number.isInteger(pick?.slot) ? [pick.slot] : []
      if (accept.length > 0) picked.push({ run: id, accept, game: run.gameName })
    } catch (err) {
      console.error(`Could not read ${file} while looking for the creator's picks; skipping it:`, err)
    }
  }
  return picked
}

// labels.json entries win over a userPick of the same run (they carry accept lists and tunedOn).
const known = new Set(labels.map((l) => l.run))
const allPicks = [...labels, ...userPickedRuns().filter((p) => !known.has(p.run))]
const tunedOn = new Map(allPicks.map((l) => [l.run, l.tunedOn ?? null]))
const cases = given.length > 0 ? given : allPicks.map((l) => `${l.run}=${l.accept.join('|')}`)
const report = { startedAt: new Date().toISOString(), trials, judgeExports: Object.keys(judge), cases: [] }

function loadRun(runId) {
  const dir = join(root, 'outputs', runId)
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'))
  const entries = run.thumbnails
    .filter((t) => t.imageUrl)
    .map((t) => ({ slot: t.slot, mimeType: 'image/png', bytes: readFileSync(join(dir, t.imageUrl.split('/').pop())) }))
  return { run, dir, entries }
}

for (const spec of cases) {
  // "<runId>=2" or, when either is a good pick, "<runId>=2|3".
  const [runId, expectedArg] = spec.split('=')
  const accepted = expectedArg.split('|').map(Number)
  const expected = accepted[0]
  if (!existsSync(join(root, 'outputs', runId, 'run.json'))) {
    console.warn(`\n=== ${runId}: not in this machine's outputs/, skipped`)
    report.cases.push({ runId, accepted, skipped: 'not in outputs/' })
    continue
  }
  const { run, dir, entries } = loadRun(runId)
  const context = judge.judgeContext ? await judge.judgeContext(run, dir) : null
  console.log(`\n=== ${run.gameName} (${runId}), expect ${expected}, context: ${context ? 'yes' : 'none'}`)
  // Trials run one after another: saved runs send their thumbnails as bytes, and fal refuses big bursts.
  const outcomes = []
  for (let i = 0; i < trials; i++) {
    const t0 = Date.now()
    let outcome = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const verdict = await judge.judgeThumbnails(run.gameName, entries, { context, ...(system ? { system } : {}) })
        outcome = { status: 'fulfilled', value: { trial: i + 1, ms: Date.now() - t0, ...verdict } }
        // fal answered: a fallback model's verdict (fewer passes, another judge) is not this judge's.
        if (verdict.provider === 'fal' || verdict.provider == null) break
        console.error(`trial ${i + 1} attempt ${attempt}: answered by ${verdict.provider} ${verdict.model}, not the fal judge; retrying`)
      } catch (reason) {
        outcome = { status: 'rejected', reason }
        console.error(`trial ${i + 1} attempt ${attempt} failed:`, reason)
      }
      await new Promise((r) => setTimeout(r, 15000))
    }
    outcomes.push(outcome)
  }
  const rows = outcomes.map((o, i) => {
    if (o.status === 'rejected') {
      console.error(`trial ${i + 1} failed:`, o.reason)
      return { trial: i + 1, error: String(o.reason) }
    }
    const v = o.value
    const totals = Object.fromEntries((v.scores ?? []).map((s) => [s.slot, s.total]))
    const passPicks = (v.passes ?? []).map((p) => `${p.winnerSlot}@${p.order.join('')}`).join(' ')
    console.log(
      `trial ${v.trial}: winner ${v.winnerSlot} ${accepted.includes(v.winnerSlot) ? "PASS" : "FAIL"} | passes ${passPicks || JSON.stringify(v.order)} | totals ${JSON.stringify(totals)} | ${v.model} ${v.ms}ms`
    )
    console.log(`  reason: ${v.reason}`)
    return { trial: v.trial, winnerSlot: v.winnerSlot, pass: accepted.includes(v.winnerSlot), order: v.order, totals, passes: v.passes, model: v.model, ms: v.ms, reason: v.reason, scores: v.scores }
  })
  const passed = rows.filter((r) => r.pass).length
  console.log(`--- ${passed}/${trials} picked ${accepted.join(" or ")}`)
  report.cases.push({ runId, gameName: run.gameName, accepted, passed, rows, tunedOn: tunedOn.get(runId) ?? null })
}

// Sets the judge was tuned on measure fit; held-out sets measure accuracy.
Object.assign(report, summarize(report))

writeFileSync(join(root, 'debug', 'rejudge_report.json'), JSON.stringify(report, null, 2))
