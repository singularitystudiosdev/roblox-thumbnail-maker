// Explore runs from the command line: every strategy drawn and judged through
// the production pipeline (no icon), each becoming an example the selector
// learns from, with the pick it would have made recorded first, so
// debug/strategy-backtest.mjs scores that pick as a held-out guess.
// Usage: node debug/explore.mjs "<prompt>" ["<prompt>" ...]
// Writes debug/explore_report.json with one entry per prompt.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, loadDotEnv } from '../server/env.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(root)
const { runThumbnails } = await import('../server/run.mjs')
const { regretsOf } = await import('../server/selector.mjs')
const style = { bytes: readFileSync(join(root, config().styleReference)), mimeType: 'image/png', name: config().styleReferenceName, source: 'bundled' }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const report = { ranAt: new Date().toISOString(), entries: [] }
const queue = process.argv.slice(2)
await Promise.all(
  Array.from({ length: Number(process.env.LANES ?? 1) }, async (_, lane) => {
    await delay(lane * 15000)
    for (let prompt = queue.shift(); prompt; prompt = queue.shift()) {
      const t0 = Date.now()
      try {
        const run = await runThumbnails({ input: prompt, style, outputsDir: join(root, 'outputs'), exploreAll: true, withIcon: false })
        const regret = regretsOf(run)
        const winner = run.slots.find((s) => s.slot === run.winnerSlot)?.strategy ?? null
        // A picked run draws the top two strategies, one thumbnail each: the better of the two is what it would have shown.
        const drawn = run.selection?.ranked?.slice(0, 2) ?? [run.selection?.arm]
        const entry = { prompt, run: run.id, pick: run.selection?.arm, drawn, fit: run.selection?.fit, expected: run.selection?.expected, winner, regret, ms: Date.now() - t0 }
        report.entries.push(entry)
        const drawnRegret = regret ? Math.min(...drawn.map((a) => regret[a])) : null
        console.log(`${prompt.slice(0, 40).padEnd(40)} would draw ${drawn.join(' + ').padEnd(18)} winner ${String(winner).padEnd(8)} regret ${drawnRegret == null ? '?' : drawnRegret.toFixed(1)}`)
      } catch (err) {
        console.error(`Explore run for "${prompt}" failed:`, err)
        report.entries.push({ prompt, error: err.message })
      }
    }
  })
)
writeFileSync(join(root, 'debug', 'explore_report.json'), `${JSON.stringify(report, null, 1)}\n`)
