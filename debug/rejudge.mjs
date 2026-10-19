// Re-judges saved runs many times to measure how consistently the judge picks
// the expected winner. Mirrors production: same judge module, same inputs a run
// gives it (its thumbnails, plus its game context when the judge takes one).
// Usage: node debug/rejudge.mjs <trials> <runId>=<expectedSlot> [...]
// Writes debug/rejudge_report.json with one entry per trial.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnv } from '../server/env.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(root)
const judge = await import('../server/judge.mjs')
// A candidate rubric to try instead of the shipped one: JUDGE_SYSTEM_FILE=/path/to/rubric.txt
const system = process.env.JUDGE_SYSTEM_FILE ? readFileSync(process.env.JUDGE_SYSTEM_FILE, 'utf8') : undefined

const [trialsArg, ...cases] = process.argv.slice(2)
const trials = Number(trialsArg) || 5
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
  const { run, dir, entries } = loadRun(runId)
  const context = judge.judgeContext ? await judge.judgeContext(run, dir) : null
  console.log(`\n=== ${run.gameName} (${runId}), expect ${expected}, context: ${context ? 'yes' : 'none'}`)
  // Trials run one after another: saved runs send their thumbnails as bytes, and fal refuses big bursts.
  const outcomes = []
  for (let i = 0; i < trials; i++) {
    const t0 = Date.now()
    try {
      const verdict = await judge.judgeThumbnails(run.gameName, entries, { context, ...(system ? { system } : {}) })
      outcomes.push({ status: 'fulfilled', value: { trial: i + 1, ms: Date.now() - t0, ...verdict } })
    } catch (reason) {
      outcomes.push({ status: 'rejected', reason })
    }
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
  report.cases.push({ runId, gameName: run.gameName, accepted, passed, rows })
}

writeFileSync(join(root, 'debug', 'rejudge_report.json'), JSON.stringify(report, null, 2))
