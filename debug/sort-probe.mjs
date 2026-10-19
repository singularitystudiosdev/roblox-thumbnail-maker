// Compares kind-sort rubrics and models on the same Roblox candidates: each
// name is searched once, then every variant sorts and picks from that pool.
// Usage: node debug/sort-probe.mjs ["name 1" "name 2" ...]
// Writes debug/sort-probe_report.json (one entry per name and variant).
import { writeFileSync } from 'node:fs'
import { loadDotEnv } from '../server/env.mjs'

loadDotEnv(process.cwd())
const { gatherCandidates, modelSort, pickNearestPopular, popularOnly, SORT_SYSTEM } = await import('../server/nearest.mjs')
const { judgeRoutes, textRoutes } = await import('../server/llm.mjs')

const OLD_SYSTEM = `You sort Roblox games by how close they are to a creator's game.
You get the creator's game (a name, or a description of it) and numbered Roblox games.
- same: the same kind of game as the creator's: the same core gameplay and theme (what the player does, and with what). Another title for the same idea counts.
- related: the same broad genre or setting, with different core gameplay.
Leave every other game out. Ignore details that only describe the thumbnail (avatar looks such as bacon hair, poses, text).
Reply as JSON: {"same": [numbers], "related": [numbers]}`

const PLAYER_SYSTEM = `You sort Roblox games by how close they are to a creator's game.
You get the creator's game (a name, or a description of it) and numbered Roblox games.
First decide what the creator's game is about the way a player would say it: its core activity and what it is done with or to (for example "growing a garden" or "racing go-karts"). A place or object that only sets the scene does not change the kind.
- same: a game a player would call the same kind of game: the same core activity with the same thing. Another title for the same idea counts.
- related: the same broad genre or setting with a different core activity, or a game that plays alike but is about another thing (bowling is related to billiards, not the same).
Leave every other game out, and leave same empty when no game is the same kind. Ignore details that only describe the thumbnail (avatar looks such as bacon hair, poses, text).
Reply as JSON: {"same": [numbers], "related": [numbers]}`

// Add a variant here to compare it with the shipped sort: { system, routes }.
const VARIANTS = {
  shipped: {},
  shipped_on_haiku: { system: SORT_SYSTEM, routes: textRoutes },
  old_rubric_sonnet: { system: OLD_SYSTEM, routes: judgeRoutes },
  player_rubric_sonnet: { system: PLAYER_SYSTEM, routes: judgeRoutes }
}

const DEFAULT_NAMES = [
  'Domino game',
  'Rob a Bank',
  'Swat a House',
  'A axe throwing game with a bacon hair in the thumbnail',
  'Bake a Cake',
  'Steal an Egg',
  'Break and Steal an Egg',
  'marble run',
  'pizza delivery',
  'ice fishing',
  'Jenga',
  'lawn mowing',
  'paper airplane'
]
const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_NAMES

async function probeName(name) {
  let pool
  try {
    pool = await gatherCandidates(name)
  } catch (err) {
    console.error(`Gathering "${name}" failed:`, err)
    return [{ name, error: String(err?.message ?? err) }]
  }
  const rows = await Promise.all(
    Object.entries(VARIANTS).map(async ([variant, opts]) => {
      let same = []
      const base = modelSort(opts)
      const sort = async (n, games) => {
        const sorted = await base(n, games)
        same = sorted.same.map((g) => `${g.name} (${g.playing})`)
        return sorted
      }
      const started = Date.now()
      try {
        const picked = await pickNearestPopular(name, [name], pool.wordQueries, pool.candidates, { sort })
        return {
          name,
          variant,
          pick: picked ? `${picked.game.name} (${picked.game.playing})` : null,
          tier: picked?.tier ?? null,
          pickedBy: picked?.pickedBy ?? null,
          same: same.slice(0, 8),
          popular: popularOnly(pool.candidates).length,
          candidates: pool.candidates.length,
          ms: Date.now() - started
        }
      } catch (err) {
        console.error(`Variant ${variant} on "${name}" failed:`, err)
        return { name, variant, error: String(err?.message ?? err) }
      }
    })
  )
  return rows
}

const report = []
// Two names at a time: Roblox search refuses a burst of parallel queries.
for (let i = 0; i < names.length; i += 2) {
  for (const rows of await Promise.all(names.slice(i, i + 2).map(probeName))) report.push(...rows)
}
for (const r of report) {
  if (r.error) console.log(`${r.name} | ${r.variant ?? 'gather'} | ERROR ${r.error.slice(0, 160)}`)
  else console.log(`${r.name} | ${r.variant} | ${r.pick ?? 'none'} | ${r.tier ?? '-'} | same: ${r.same.join('; ')}`)
}
writeFileSync('debug/sort-probe_report.json', JSON.stringify({ at: new Date().toISOString(), report }, null, 2))
