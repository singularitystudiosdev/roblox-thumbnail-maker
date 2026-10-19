// Thumbnails 2 to 4 remix one real Roblox thumbnail: a popular game of the
// same kind as the creator's. Candidates are Roblox search results for the name
// itself, its keywords and the genre queries a text model writes from it. A text
// model sorts every candidate into games named for the creator's (their words,
// or the same words said another way), the same kind of game and related ones
// (titles holding the whole name are named for it) before popularity filters
// them, so it sees the real games of the kind even when none is popular right
// now. Then only popular games count: the most played game named for the
// creator's wins, then the most played of the same kind (a bigger game of the
// kind lost "Ragdoll Soccer" its own idea, Ragdoll Football, to Illegal
// Soccer); failing both, the closest popular related game. Without a model,
// shared words sort them.
import { askJson, judgeRoutes, textRoutes } from './llm.mjs'
import { nameTokens, sameWord, searchGames, withThumbnails, withVisits } from './roblox.mjs'

const RESULTS_PER_QUERY = 15
const MAX_QUERIES = 5
const MAX_CANDIDATES = 40

const QUERY_SYSTEM = `You turn a Roblox game name or description into Roblox search queries that find existing games of the same kind.
- 1 to 3 queries, each 1 to 4 words, naming the core gameplay or theme (examples: "axe throwing", "steal egg", "prison escape", "grow garden").
- Leave out what should appear in the thumbnail (characters, avatar looks such as bacon hair or noob, poses, text) and filler words such as game, roblox or thumbnail.
Reply as JSON: {"queries": ["..."]}`

const QUERY_SCHEMA = {
  type: 'OBJECT',
  properties: { queries: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['queries']
}

// A reference from a game nobody plays is not what players click: more than this many playing now.
export const MIN_PLAYING = 300
// Playing now is one moment, and late at night an established game sits well under its daytime
// count: a game with ESTABLISHED_VISITS lifetime visits still counts with QUIET_HOUR_PLAYING playing.
export const ESTABLISHED_VISITS = 10_000_000
export const QUIET_HOUR_PLAYING = 100

export const SORT_SYSTEM = `You sort Roblox games by how close they are to a creator's game.
You get the creator's game (a name, or a description of it) and numbered Roblox games.
- named: games whose title names the creator's game itself: every one of the creator's words is in the title, as written or as a word that means the same (football for soccer, a plural, another order). A title that drops one of the creator's words or swaps it for a merely related one (hotel for horror hotel, evil for killer) is not named, however close its gameplay.
- same: the same kind of game as the creator's: the same core gameplay and theme (what the player does, and with what). Another title for the same idea counts. List the named games here too.
- related: the same broad genre or setting, with different core gameplay. List them closest to the creator's game first.
Leave every other game out. Ignore details that only describe the thumbnail (avatar looks such as bacon hair, poses, text).
Reply as JSON: {"named": [numbers], "same": [numbers], "related": [numbers]}`

const SORT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    named: { type: 'ARRAY', items: { type: 'INTEGER' } },
    same: { type: 'ARRAY', items: { type: 'INTEGER' } },
    related: { type: 'ARRAY', items: { type: 'INTEGER' } }
  },
  required: ['named', 'same', 'related']
}

/** The name's meaningful words as one search query: "axe throwing bacon hair". */
export const keywordQuery = (name) => nameTokens(name).join(' ')

/** Distinct queries in priority order, at most MAX_QUERIES. */
export function searchPlan(...groups) {
  const seen = new Set()
  const queries = []
  for (const query of groups.flat()) {
    const text = String(query ?? '').replace(/\s+/g, ' ').trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    queries.push(text)
  }
  return queries.slice(0, MAX_QUERIES)
}

async function genreQueries(gameName) {
  try {
    const { value } = await askJson({ label: 'Genre queries', system: QUERY_SYSTEM, user: `User's game: ${gameName}`, schema: QUERY_SCHEMA }, textRoutes())
    return (Array.isArray(value.queries) ? value.queries : []).filter((q) => typeof q === 'string').slice(0, 3)
  } catch (err) {
    console.error(`No genre queries for "${gameName}", searching its own words only:`, err)
    return []
  }
}

async function searchAll(queries) {
  const settled = await Promise.allSettled(queries.map((q) => searchGames(q)))
  return settled.flatMap((outcome, i) => {
    if (outcome.status === 'fulfilled') return [outcome.value.slice(0, RESULTS_PER_QUERY)]
    console.error(`Roblox search for "${queries[i]}" failed:`, outcome.reason)
    return []
  })
}

/** Result lists merged rank by rank (each query's best hits first), duplicates dropped. */
export function mergeResults(lists, limit = MAX_CANDIDATES) {
  const byId = new Map()
  const depth = Math.max(0, ...lists.map((l) => l.length))
  for (let rank = 0; rank < depth; rank++) {
    for (const list of lists) {
      const game = list[rank]
      if (game && !byId.has(game.universeId)) byId.set(game.universeId, game)
    }
  }
  return [...byId.values()].slice(0, limit)
}

/** How near a title is: the largest share of any one query's words it contains. */
export function nearness(queries, title) {
  const tokens = nameTokens(title)
  let best = 0
  for (const query of queries) {
    const words = nameTokens(query)
    if (words.length === 0) continue
    const shared = words.filter((w) => tokens.some((t) => sameWord(w, t))).length
    best = Math.max(best, shared / words.length)
  }
  return best
}

/** More than MIN_PLAYING playing now, or an established game in a quiet hour. */
export const isPopular = (g) => g.playing > MIN_PLAYING || (g.playing >= QUIET_HOUR_PLAYING && (g.visits ?? 0) >= ESTABLISHED_VISITS)

export const popularOnly = (games) => games.filter(isPopular)

/** Games whose popularity hangs on their visits: the only ones worth a details lookup. */
const nearTheFloor = (g) => g.playing >= QUIET_HOUR_PLAYING && g.playing <= MIN_PLAYING

/** Why a game counts as popular, for the reference card. */
export function popularity(g) {
  if (g.playing > MIN_PLAYING) return `over ${MIN_PLAYING} playing`
  return `${g.playing} playing now and ${Math.round(g.visits / 1e5) / 10}M visits`
}

/** Games whose title holds every word of one of the names (the game name, a linked game's title). */
export function wholeNameMatches(names, games) {
  const named = names.filter((name) => nameTokens(name).length > 0)
  return games.filter((game) => named.some((name) => nearness([name], game.name) === 1))
}

/** Without a model: half a query's words in the title makes the same kind, any shared word related, nearest first. */
export function sortByWords(queries, games) {
  const same = games.filter((g) => nearness(queries, g.name) >= 0.5)
  const related = games
    .filter((g) => !same.includes(g) && nearness(queries, g.name) > 0)
    .sort((a, b) => nearness(queries, b.name) - nearness(queries, a.name))
  return { same, related }
}

/** The most played of `games` with how many there were, or null for none. */
export function mostPlayedOf(games) {
  if (games.length === 0) return null
  return { count: games.length, game: games.reduce((best, g) => (g.playing > best.playing ? g : best)) }
}

/**
 * A model's sort into named for the creator's game, the same kind and related, related closest first. The
 * judge's model sorts by default: the small text model called a prison escape
 * game the same kind as a SWAT raid. Rubric and routes are swappable for probes.
 */
export function modelSort({ system = SORT_SYSTEM, routes = judgeRoutes } = {}) {
  return async (gameName, games) => {
    const list = games.map((g, i) => `${i + 1}. ${g.name}`).join('\n')
    const { value, model } = await askJson(
      { label: 'Game kind sort', system, user: `Creator's game: ${gameName}\n\nRoblox games:\n${list}`, schema: SORT_SCHEMA },
      routes()
    )
    const pick = (numbers) => [...new Set(Array.isArray(numbers) ? numbers : [])].map((n) => games[Number(n) - 1]).filter(Boolean)
    return { named: pick(value.named), same: pick(value.same), related: pick(value.related), sortedBy: model }
  }
}

const sortWithModel = modelSort()

/**
 * Sorts every candidate by kind, then takes the most played popular game named
 * for the creator's (sorted.named, and every title holding the whole name), else
 * the most played popular game of the same kind, else the closest popular related
 * one; null when none is any. The sort sees the unpopular games too: shown only the popular
 * ones, it called the nearest of the wrong kind the same kind whenever every
 * game of the right kind was quiet. A related game is a stand-in, so closeness
 * picks it: the most played related game was a hangout game with 200K players
 * for axe throwing. `sort` is the model sort (swappable in tests); shared words
 * stand in when it fails.
 */
export async function pickNearestPopular(gameName, names, queries, candidates, { sort = sortWithModel } = {}) {
  if (!candidates.some(isPopular)) return null
  let sorted
  try {
    sorted = await sort(gameName, candidates)
  } catch (err) {
    console.error(`Sorting games like "${gameName}" failed; sorting by shared words:`, err)
    sorted = { ...sortByWords(queries, candidates), sortedBy: 'shared words' }
  }
  const named = [...new Set([...wholeNameMatches(names, candidates), ...(sorted.named ?? [])])]
  const same = [...new Set([...named, ...sorted.same])]
  const namedFor = mostPlayedOf(popularOnly(named))
  if (namedFor) {
    const lead = namedFor.count === 1 ? 'The only popular game named for yours' : `The most played of ${namedFor.count} popular games named for yours`
    return { game: namedFor.game, tier: 'named', pickedBy: sorted.sortedBy, why: `${lead}, with ${popularity(namedFor.game)}.` }
  }
  const sameKind = mostPlayedOf(popularOnly(same))
  if (sameKind) {
    const lead = sameKind.count === 1 ? 'The only popular game of the same kind' : `The most played of ${sameKind.count} popular games of the same kind`
    return { game: sameKind.game, tier: 'same', pickedBy: sorted.sortedBy, why: `${lead}, with ${popularity(sameKind.game)}.` }
  }
  const closest = sorted.related.find((g) => !same.includes(g) && isPopular(g))
  if (!closest) return null
  return { game: closest, tier: 'related', pickedBy: sorted.sortedBy, why: `No popular game of the same kind; the closest popular game in a related genre, with ${popularity(closest)}.` }
}

/** Visits for the games whose popularity depends on them; without them those games stay unpopular. */
async function visitsNearTheFloor(games) {
  const near = games.filter(nearTheFloor)
  if (near.length === 0) return games
  try {
    const looked = new Map((await withVisits(near)).map((g) => [g.universeId, g]))
    return games.map((g) => looked.get(g.universeId) ?? g)
  } catch (err) {
    console.error(`Visit counts for ${near.length} quiet games failed; only games over ${MIN_PLAYING} playing count:`, err)
    return games
  }
}

/**
 * Every Roblox search hit for the name, its keywords and its genre queries:
 * popular games with their thumbnails, quiet games kept for the sort.
 * `wordQueries` sort by shared words when the model cannot: genre first.
 */
export async function gatherCandidates(gameName, extraNames = []) {
  const base = searchPlan(gameName, extraNames, keywordQuery(gameName))
  const [genre, baseResults] = await Promise.all([genreQueries(gameName), searchAll(base)])
  const queries = searchPlan(base, genre)
  const extraResults = await searchAll(queries.filter((q) => !base.includes(q)))
  const merged = await visitsNearTheFloor(mergeResults([...baseResults, ...extraResults]))
  const ready = new Map((await withThumbnails(popularOnly(merged))).map((g) => [g.universeId, g]))
  // A popular game whose thumbnail is not ready drops out.
  const candidates = merged.flatMap((g) => (isPopular(g) ? (ready.has(g.universeId) ? [ready.get(g.universeId)] : []) : [g]))
  return { queries, wordQueries: searchPlan(genre, base), candidates }
}

/**
 * A popular Roblox game of the same kind as `gameName` with its 16:9 thumbnail,
 * or null when Roblox has no popular game like it.
 * `extraNames` (a linked game's title) are searched right after the name.
 */
export async function findNearestPopular(gameName, { extraNames = [] } = {}) {
  const { queries, wordQueries, candidates } = await gatherCandidates(gameName, extraNames)
  const picked = await pickNearestPopular(gameName, [gameName, ...extraNames], wordQueries, candidates)
  if (!picked) {
    console.warn(`No popular Roblox game like "${gameName}"; the remixes use the style reference.`)
    return null
  }
  const candidateCount = popularOnly(candidates).length
  return { ...picked.game, queries, candidateCount, tier: picked.tier, pickedBy: picked.pickedBy, why: picked.why }
}
