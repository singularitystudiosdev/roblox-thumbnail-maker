// Backtests the search meta's pick for a batch of names: the main nearest
// popular game (the other Roblox slots' reference) and the search meta's game,
// which must differ. Usage: node debug/searchtop-probe.mjs ["name 1" ...]
// Writes debug/searchtop-probe_report.json (one entry per name).
import { writeFileSync } from 'node:fs'
import { loadDotEnv } from '../server/env.mjs'

loadDotEnv(process.cwd())
const { findNearestPopular } = await import('../server/nearest.mjs')
const { pickSearchTop, rankSearch } = await import('../server/searchtop.mjs')

const DEFAULT_NAMES = ['bury a body', 'explode noobs', 'Rob Grandmas House', 'Steal an Egg', 'Domino game', 'Rob a Bank', 'Swat a House']
const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_NAMES

async function probe(name) {
  try {
    const nearest = await findNearestPopular(name).catch((err) => {
      console.error(`Nearest game for "${name}" failed:`, err)
      return null
    })
    const ranking = await rankSearch(name, { anchor: nearest?.name })
    const picked = await pickSearchTop(name, ranking, { exclude: nearest ? [nearest.universeId] : [] })
    return {
      name,
      nearest: nearest ? `${nearest.name} (${nearest.playing})` : null,
      searchPick: picked ? `${picked.name} (${picked.playing})` : null,
      same: ranking.ranked.filter((g) => g.match === 'same').map((g) => `${g.name} (${g.playing})`),
      why: picked?.why ?? null,
      differs: !nearest || !picked || nearest.universeId !== picked.universeId
    }
  } catch (err) {
    console.error(`Probe of "${name}" failed:`, err)
    return { name, error: String(err?.message ?? err) }
  }
}

const report = []
// Two at a time: Roblox search refuses a burst of parallel queries.
for (let i = 0; i < names.length; i += 2) report.push(...(await Promise.all(names.slice(i, i + 2).map(probe))))
for (const r of report) {
  if (r.error) console.log(`${r.name} | ERROR ${r.error}`)
  else console.log(`${r.name} | search meta: ${r.searchPick} | main: ${r.nearest} | differs: ${r.differs} | same idea: ${r.same.join('; ')} | ${r.why}`)
}
writeFileSync('debug/searchtop-probe_report.json', JSON.stringify({ at: new Date().toISOString(), report }, null, 2))
