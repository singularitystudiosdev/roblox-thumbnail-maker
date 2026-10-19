// Thumbnails 2 and 3 remix one real Roblox thumbnail: the game nearest to the
// game name and most popular. Candidates are Roblox search results for the name
// itself, its keywords and the genre queries a text model writes from it. When
// titles hold the whole name, the most played of them wins outright; otherwise
// (a description) the model picks the nearest candidate, the most played among
// equally near ones. Without a model the pick is by shared words, then players.
import { askJson, textRoutes, withoutDashes } from './llm.mjs'
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

const PICK_SYSTEM = `You pick the reference thumbnail for a new Roblox game thumbnail: the existing Roblox game nearest to the user's game and most popular.
You get the user's game (a name, or a description of it) and numbered candidates, each with how many people are playing it right now.
- Nearest: the same gameplay and theme (what the player does, the setting). Ignore details that only describe the thumbnail (avatar looks such as bacon hair, poses, text).
- Among candidates about as near as each other, choose the one with the most players.
- Never choose a popular game of a different kind over a near one.
Reply as JSON: {"index": <candidate number>, "why": "<one short sentence without dashes>"}`

const PICK_SCHEMA = {
  type: 'OBJECT',
  properties: { index: { type: 'INTEGER' }, why: { type: 'STRING' } },
  required: ['index', 'why']
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

/** Nearest by shared words, then most played (ties keep Roblox's order); the top five results when nothing shares a word. */
export function pickByWords(queries, games) {
  if (games.length === 0) return null
  const scored = games.map((game) => ({ game, near: nearness(queries, game.name) }))
  const top = Math.max(...scored.map((s) => s.near))
  const pool = top > 0 ? scored.filter((s) => s.near === top) : scored.slice(0, 5)
  return pool.reduce((best, s) => (best.game.playing >= s.game.playing ? best : s)).game
}

/**
 * The most played candidate whose title holds every word of one of the names
 * (the game name, a linked game's title): as near as a title gets, so no model
 * is asked. Null when no title holds a whole name, as with a description.
 */
export function pickWholeNameMatch(names, games) {
  let best = null
  for (const name of names) {
    if (nameTokens(name).length === 0) continue
    for (const game of games) {
      if (nearness([name], game.name) === 1 && (!best || game.playing > best.game.playing)) best = { game, name }
    }
  }
  return best
}

async function pickNearest(gameName, names, queries, candidates) {
  const whole = pickWholeNameMatch(names, candidates)
  if (whole) {
    const why = `Its title holds every word of "${whole.name}", and it has the most players of the games whose titles do.`
    return { game: whole.game, pickedBy: 'whole name match', why }
  }
  const list = candidates.map((g, i) => `${i + 1}. ${g.name} (${g.playing} playing)`).join('\n')
  try {
    const { value, model } = await askJson(
      { label: 'Nearest game pick', system: PICK_SYSTEM, user: `User's game: ${gameName}\n\nCandidates:\n${list}`, schema: PICK_SCHEMA },
      textRoutes()
    )
    const game = candidates[Number(value.index) - 1]
    if (game) return { game, pickedBy: model, why: withoutDashes(value.why) }
    console.warn(`Nearest game pick answered index ${value.index} of ${candidates.length}; picking by shared words.`)
  } catch (err) {
    console.error(`Nearest game pick for "${gameName}" failed; picking by shared words:`, err)
  }
  return { game: pickByWords(queries, candidates), pickedBy: 'shared words', why: 'Most played of the titles sharing the most words with the game name.' }
}

/**
 * The nearest, most popular Roblox game to `gameName` with its 16:9 thumbnail,
 * or null when Roblox returns nothing. `extraNames` (a linked game's title)
 * are searched right after the name.
 */
export async function findNearestPopular(gameName, { extraNames = [] } = {}) {
  const base = searchPlan(gameName, extraNames, keywordQuery(gameName))
  const [genre, baseResults] = await Promise.all([genreQueries(gameName), searchAll(base)])
  const queries = searchPlan(base, genre)
  const extraResults = await searchAll(queries.filter((q) => !base.includes(q)))
  const candidates = await withThumbnails(mergeResults([...baseResults, ...extraResults]))
  if (candidates.length === 0) return null
  // Genre queries name the gameplay; they rank nearness ahead of the raw name.
  const rankQueries = searchPlan(genre, base)
  const { game, pickedBy, why } = await pickNearest(gameName, [gameName, ...extraNames], rankQueries, candidates)
  return { ...game, queries, candidateCount: candidates.length, pickedBy, why }
}
