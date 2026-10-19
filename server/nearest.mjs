// Thumbnails 2 and 3 remix one real Roblox thumbnail: a popular game of the
// same kind as the creator's. Candidates are Roblox search results for the name
// itself, its keywords and the genre queries a text model writes from it; only
// games with more than MIN_PLAYING players count. A text model sorts those into
// the same kind of game and related ones (titles holding the whole name are the
// same kind), and players decide: the most played game of the same kind wins,
// else the most played related one. Without a model, shared words sort them.
import { askJson, textRoutes } from './llm.mjs'
import { nameTokens, sameWord, searchGames, withThumbnails } from './roblox.mjs'

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

const SORT_SYSTEM = `You sort Roblox games by how close they are to a creator's game.
You get the creator's game (a name, or a description of it) and numbered Roblox games.
- same: the same kind of game as the creator's: the same core gameplay and theme (what the player does, and with what). Another title for the same idea counts.
- related: the same broad genre or setting, with different core gameplay.
Leave every other game out. Ignore details that only describe the thumbnail (avatar looks such as bacon hair, poses, text).
Reply as JSON: {"same": [numbers], "related": [numbers]}`

const SORT_SCHEMA = {
  type: 'OBJECT',
  properties: { same: { type: 'ARRAY', items: { type: 'INTEGER' } }, related: { type: 'ARRAY', items: { type: 'INTEGER' } } },
  required: ['same', 'related']
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

/** Only games with more than MIN_PLAYING players right now. */
export const popularOnly = (games) => games.filter((g) => g.playing > MIN_PLAYING)

/** Games whose title holds every word of one of the names (the game name, a linked game's title). */
export function wholeNameMatches(names, games) {
  const named = names.filter((name) => nameTokens(name).length > 0)
  return games.filter((game) => named.some((name) => nearness([name], game.name) === 1))
}

/** Without a model: half a query's words in the title makes the same kind, any shared word related. */
export function sortByWords(queries, games) {
  const same = games.filter((g) => nearness(queries, g.name) >= 0.5)
  const related = games.filter((g) => !same.includes(g) && nearness(queries, g.name) > 0)
  return { same, related }
}

/** The most played game of the first tier that has any, with the tier and how many games it held. */
export function mostPlayedOf(tiers) {
  for (const [tier, games] of tiers) {
    if (games.length > 0) return { tier, count: games.length, game: games.reduce((best, g) => (g.playing > best.playing ? g : best)) }
  }
  return null
}

async function sortWithModel(gameName, games) {
  const list = games.map((g, i) => `${i + 1}. ${g.name}`).join('\n')
  const { value, model } = await askJson(
    { label: 'Game kind sort', system: SORT_SYSTEM, user: `Creator's game: ${gameName}\n\nRoblox games:\n${list}`, schema: SORT_SCHEMA },
    textRoutes()
  )
  const pick = (numbers) => [...new Set(Array.isArray(numbers) ? numbers : [])].map((n) => games[Number(n) - 1]).filter(Boolean)
  return { same: pick(value.same), related: pick(value.related), sortedBy: model }
}

/**
 * Of the popular candidates, the most played of the same kind as the creator's
 * game, else the most played related one; null when none is either. `sort`
 * is the model sort (swappable in tests); shared words stand in when it fails.
 */
export async function pickNearestPopular(gameName, names, queries, popular, { sort = sortWithModel } = {}) {
  if (popular.length === 0) return null
  let sorted
  try {
    sorted = await sort(gameName, popular)
  } catch (err) {
    console.error(`Sorting games like "${gameName}" failed; sorting by shared words:`, err)
    sorted = { ...sortByWords(queries, popular), sortedBy: 'shared words' }
  }
  const same = [...new Set([...wholeNameMatches(names, popular), ...sorted.same])]
  const related = sorted.related.filter((g) => !same.includes(g))
  const pick = mostPlayedOf([['same', same], ['related', related]])
  if (!pick) return null
  const kind = pick.tier === 'same' ? 'of the same kind' : 'in a related genre'
  const why =
    pick.count === 1
      ? `The only game ${kind} with over ${MIN_PLAYING} players.`
      : `The most played of ${pick.count} games ${kind} with over ${MIN_PLAYING} players.`
  return { game: pick.game, tier: pick.tier, pickedBy: sorted.sortedBy, why }
}

/**
 * A popular Roblox game of the same kind as `gameName` with its 16:9 thumbnail,
 * or null when Roblox has none with more than MIN_PLAYING players.
 * `extraNames` (a linked game's title) are searched right after the name.
 */
export async function findNearestPopular(gameName, { extraNames = [] } = {}) {
  const base = searchPlan(gameName, extraNames, keywordQuery(gameName))
  const [genre, baseResults] = await Promise.all([genreQueries(gameName), searchAll(base)])
  const queries = searchPlan(base, genre)
  const extraResults = await searchAll(queries.filter((q) => !base.includes(q)))
  const popular = await withThumbnails(popularOnly(mergeResults([...baseResults, ...extraResults])))
  // Genre queries name the gameplay; they sort by words ahead of the raw name.
  const picked = await pickNearestPopular(gameName, [gameName, ...extraNames], searchPlan(genre, base), popular)
  if (!picked) {
    console.warn(`No Roblox game like "${gameName}" has over ${MIN_PLAYING} players; the remixes use the style reference.`)
    return null
  }
  return { ...picked.game, queries, candidateCount: popular.length, tier: picked.tier, pickedBy: picked.pickedBy, why: picked.why }
}
