// Thumbnail 3, the search meta, starts from a second Roblox game: the top of
// one plain Roblox search for the name as typed. A model keeps the results that
// are the same game idea as the name (another wording of the same act counts, a
// shared word does not), and the most played of those wins; with none, the
// model's closest related result, then the search's own order. A game the other
// Roblox slots already use is skipped, so the run gets a second reference. No
// popularity floor: the search's results are the pool.
import { askJson, judgeRoutes } from './llm.mjs'
import { searchGames, withThumbnails } from './roblox.mjs'

export const SAME_IDEA_SYSTEM = `You match a creator's Roblox game to the results of a Roblox search for its name.
You get the creator's game (a name, or a description of it) and the numbered search results.
First read the creator's name the way a Roblox player would: what the player does, and to what. Words keep the meaning they have in Roblox game titles, and the game the other thumbnails start from, when given, shows how the name reads.
- same: results that are the same game idea as the creator's: a player reading both names would expect to do the same thing. Different words for the same act count (chop a tree and cut down trees); a result that only shares a word, a setting or a genre does not (plant a tree, a forest roleplay).
- related: results close to it with a different idea, closest first.
Leave every other result out. Ignore details that only describe the thumbnail (avatar looks such as bacon hair, poses, text).
Reply as JSON: {"same": [numbers], "related": [numbers]}`

const SAME_IDEA_SCHEMA = {
  type: 'OBJECT',
  properties: { same: { type: 'ARRAY', items: { type: 'INTEGER' } }, related: { type: 'ARRAY', items: { type: 'INTEGER' } } },
  required: ['same', 'related']
}

// How many of the ranked results to fetch thumbnails for before giving up.
const THUMBNAIL_TRIES = 10

// Without the other thumbnails' game in view the model read "Swat a House" as hitting a house and found no SWAT game.
async function sameIdeaWithModel(gameName, games, anchor) {
  const list = games.map((g, i) => `${i + 1}. ${g.name}`).join('\n')
  const context = anchor ? `\nThe other thumbnails start from a popular game like it: ${anchor}.` : ''
  const { value, model } = await askJson(
    { label: 'Same idea search pick', system: SAME_IDEA_SYSTEM, user: `Creator's game: ${gameName}${context}\n\nRoblox search results:\n${list}`, schema: SAME_IDEA_SCHEMA },
    judgeRoutes()
  )
  const pick = (numbers) => [...new Set(Array.isArray(numbers) ? numbers : [])].map((n) => games[Number(n) - 1]).filter(Boolean)
  return { same: pick(value.same), related: pick(value.related), pickedBy: model }
}

/**
 * The plain search's results in the order the meta takes them: the same-idea
 * games, most played first; then the related ones, closest first; then the
 * rest in Roblox's order. Without a model, Roblox's order alone. `anchor`: the
 * name of the game the other thumbnails start from. `search` and `sameIdea`
 * are swappable in tests.
 */
export async function rankSearch(gameName, { anchor = null, search = searchGames, sameIdea = sameIdeaWithModel } = {}) {
  const results = await search(gameName)
  if (results.length === 0) return { ranked: [], sameCount: 0, pickedBy: null }
  try {
    const { same, related = [], pickedBy } = await sameIdea(gameName, results, anchor)
    const close = related.filter((g) => !same.includes(g))
    const tagged = (games, match) => games.map((g) => ({ ...g, match }))
    const ranked = [
      ...tagged([...same].sort((a, b) => b.playing - a.playing), 'same'),
      ...tagged(close, 'related'),
      ...tagged(results.filter((g) => !same.includes(g) && !close.includes(g)), 'search order')
    ]
    return { ranked, sameCount: same.length, pickedBy }
  } catch (err) {
    console.error(`Picking the same-idea results for "${gameName}" failed; using Roblox's search order:`, err)
    return { ranked: results.map((g) => ({ ...g, match: 'search order' })), sameCount: 0, pickedBy: 'search order' }
  }
}

/**
 * The first ranked game that is not in `exclude` (universe ids the other Roblox
 * slots use) and has a thumbnail, with why it was picked; null when none has.
 */
export async function pickSearchTop(gameName, { ranked, sameCount }, { exclude = [], thumbnails = withThumbnails } = {}) {
  const skipped = ranked.filter((g) => exclude.includes(g.universeId))
  const open = ranked.filter((g) => !exclude.includes(g.universeId)).slice(0, THUMBNAIL_TRIES)
  const [game] = await thumbnails(open)
  if (!game) return null
  const already = skipped.length > 0 ? ` ${skipped[0].name} is already the other thumbnails' reference, so the next one.` : ''
  const search = `a Roblox search for "${gameName}"`
  const why = {
    same: `The most played of ${sameCount} results of ${search} that are the same game idea, with ${game.playing} playing.`,
    related: `No other result of ${search} is the same game idea, so the closest related one.`,
    'search order': `No other result of ${search} is the same game idea or related, so the search's own first result.`
  }[game.match]
  return { ...game, why: `${why}${already}` }
}
