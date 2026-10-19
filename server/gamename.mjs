// What the user typed -> the GAME_NAME for the template. A roblox.com link is
// named by its URL slug ("Steal-An-Egg" is "Steal an Egg"), or by Roblox when
// the link has no slug; anything else is the user's own words, verbatim, minus
// a "make me a thumbnail for my game" wrapper. No model rewrites the name.
import { extractGameName } from './prompt.mjs'
import { cleanTitle, findGameLink, gameFromPlace, titleFromSlug } from './roblox.mjs'

const LINK_MARK = 'ROBLOXGAMELINKMARK'

/**
 * `gameName`, how it was named ('link': from the link alone, 'typed': the
 * user's words) and the link when there was one. A link inside a description
 * is replaced by its game's name, so the rest of the description stays as typed.
 */
export async function resolveGameName(input, { lookupPlace = gameFromPlace } = {}) {
  const text = String(input ?? '').trim()
  const link = findGameLink(text)
  if (!link) return { gameName: extractGameName(text), namedBy: 'typed', link: null }

  const title = link.slug ? titleFromSlug(link.slug) : cleanTitle((await lookupPlace(link.placeId)).name)
  const extracted = extractGameName(text.replace(link.raw, LINK_MARK))
  const linkOnly = extracted === LINK_MARK || !extracted.replace(LINK_MARK, '').trim()
  return {
    gameName: linkOnly ? title : extracted.replace(LINK_MARK, () => title).replace(/\s+/g, ' ').trim(),
    namedBy: linkOnly ? 'link' : 'typed',
    link: { placeId: link.placeId, title, url: `https://www.roblox.com/games/${link.placeId}${link.slug ? `/${link.slug}` : ''}` }
  }
}
