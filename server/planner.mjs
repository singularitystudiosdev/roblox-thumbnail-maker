// What the user typed -> the game they mean -> a descriptive title for the
// prompt, plus the style reference (the most-played Roblox game near the name).
import { config } from './env.mjs'
import { cleanTitle, describeGame } from './namer.mjs'
import { buildPrompt, extractGameName, stripQuotes } from './prompt.mjs'
import { closestTitleMatch, gameDetails, gameFromPlace, parseGameUrl, pickReference, searchNear } from './roblox.mjs'

export const fallbackReference = (query) => ({ source: 'fallback', name: config().referenceName, thumbnailUrl: '/api/reference', query })

async function searchOrNull(name) {
  try {
    return await searchNear(name)
  } catch (err) {
    console.error(`Roblox search for "${name}" failed:`, err)
    return null
  }
}

/** The most-played Roblox game near the name, or the bundled reference when search fails or finds nothing. */
export async function referenceFor(name, results) {
  const found = pickReference(name, results ?? (await searchOrNull(name)) ?? [])
  if (found) return { source: 'roblox', nearCount: found.nearCount, query: name, ...found.game }
  console.warn(`No Roblox game found near "${name}", using the bundled reference.`)
  return fallbackReference(name)
}

async function detailsOrNull(match) {
  try {
    return (await gameDetails([match.universeId]))[0] ?? null
  } catch (err) {
    console.error(`Roblox details for "${match.name}" failed:`, err)
    return null
  }
}

/**
 * `keepName` sends the text as the title untouched (an edited name); otherwise
 * a roblox.com link names its game outright, and typed words are matched to
 * the closest Roblox title, whose description the namer condenses.
 */
export async function planThumbnail(input, { keepName = false } = {}) {
  const placeId = keepName ? null : parseGameUrl(input)
  const linked = placeId ? await gameFromPlace(placeId) : null
  const typed = keepName ? stripQuotes(input) : linked ? linked.name : extractGameName(input)
  const searchName = cleanTitle(typed) || typed
  const results = await searchOrNull(searchName)
  const reference = await referenceFor(searchName, results ?? [])

  if (keepName) return { gameName: typed, prompt: buildPrompt(typed), reference, describedFrom: null, namedBy: 'typed' }

  const match = linked ? null : closestTitleMatch(searchName, results ?? [])
  const game = linked ?? (match ? await detailsOrNull(match) : null)
  const { title, namedBy } = await describeGame({ request: input, typed, game })
  return {
    gameName: title,
    prompt: buildPrompt(title),
    reference,
    describedFrom: game ? { name: game.name, url: game.url, playing: game.playing } : null,
    namedBy
  }
}
