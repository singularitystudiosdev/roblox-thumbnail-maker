// Runs the nearest-popular-game pick for a batch of names and prints what each
// one chose, so a change to the pick can be compared across many names.
// Usage: node debug/nearest-probe.mjs [label] ["name 1" "name 2" ...]
// Writes debug/nearest-probe_report.json (one entry per name).
import { writeFileSync } from 'node:fs'
import { loadDotEnv } from '../server/env.mjs'

loadDotEnv(process.cwd())
const { findNearestPopular } = await import('../server/nearest.mjs')

const DEFAULT_NAMES = [
  'Domino game',
  'Bake a Cake',
  'Rob a Bank',
  'Steal an Egg',
  'Swat a House',
  'A axe throwing game with a bacon hair in the thumbnail',
  'marble run',
  'pizza delivery',
  'ice fishing',
  'Jenga',
  'lawn mowing',
  'paper airplane'
]
const [label = 'run', ...given] = process.argv.slice(2)
const names = given.length > 0 ? given : DEFAULT_NAMES
const CONCURRENCY = 4

async function probe(name) {
  const started = Date.now()
  try {
    const ref = await findNearestPopular(name)
    const row = ref
      ? { name, pick: ref.name, playing: ref.playing, visits: ref.visits ?? null, tier: ref.tier, why: ref.why, candidates: ref.candidateCount, queries: ref.queries }
      : { name, pick: null }
    return { ...row, ms: Date.now() - started }
  } catch (err) {
    console.error(`Probe of "${name}" failed:`, err)
    return { name, error: String(err?.message ?? err), ms: Date.now() - started }
  }
}

const report = []
for (let i = 0; i < names.length; i += CONCURRENCY) {
  report.push(...(await Promise.all(names.slice(i, i + CONCURRENCY).map(probe))))
}
for (const r of report) {
  const pick = r.error ? `ERROR ${r.error}` : r.pick ? `${r.pick} | ${r.playing} playing${r.visits != null ? `, ${Math.round(r.visits / 1e5) / 10}M visits` : ''} | ${r.tier} | ${r.why}` : 'none'
  console.log(`[${label}] ${r.name} -> ${pick}`)
}
writeFileSync(`debug/nearest-probe_report.json`, JSON.stringify({ label, at: new Date().toISOString(), report }, null, 2))
