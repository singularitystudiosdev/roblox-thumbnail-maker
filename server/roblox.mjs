// Public Roblox endpoints: omni-search for games, multiget for their 16:9
// thumbnails, place and universe lookups for a pasted game link, plus the
// word rules shared by name extraction and reference ranking.
import { randomUUID } from 'node:crypto'
import { imageMimeType } from './mime.mjs'

const SEARCH_URL = 'https://apis.roblox.com/search-api/omni-search'
const THUMBS_URL = 'https://thumbnails.roblox.com/v1/games/multiget/thumbnails'
const GAMES_URL = 'https://games.roblox.com/v1/games'
const PLACE_UNIVERSE_URL = 'https://apis.roblox.com/universes/v1/places'

/** A Roblox link that does not lead to a game: the user's input, not a server fault. */
export class GameNotFound extends Error {}
const HEADERS = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 roblox-thumbnail-maker' }

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`Roblox answered ${res.status} for ${new URL(url).pathname}`)
  return res.json()
}

/** Flattens an omni-search payload into game rows, sponsored slots dropped. */
export function gamesFromSearch(payload) {
  const rows = []
  for (const group of payload?.searchResults ?? []) {
    if (group.contentGroupType !== 'Game') continue
    for (const game of group.contents ?? []) {
      if (game.isSponsored || !game.universeId) continue
      rows.push({
        universeId: game.universeId,
        placeId: game.rootPlaceId,
        name: game.name,
        playing: game.playerCount ?? 0,
        url: `https://www.roblox.com${game.canonicalUrlPath ?? `/games/${game.rootPlaceId}`}`
      })
    }
  }
  return rows
}

export async function searchGames(query) {
  const url = `${SEARCH_URL}?searchQuery=${encodeURIComponent(query)}&pageType=all&sessionId=${randomUUID()}`
  return gamesFromSearch(await getJson(url))
}

// Roblox caps multiget at 100 universes; a run never asks for more than this.
const THUMBS_BATCH = 100

/** Adds `thumbnailUrl` to each game; games whose thumbnail is not ready are dropped. */
export async function withThumbnails(games) {
  const batch = games.slice(0, THUMBS_BATCH)
  if (batch.length === 0) return []
  const ids = batch.map((g) => g.universeId).join(',')
  const payload = await getJson(
    `${THUMBS_URL}?universeIds=${ids}&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false`
  )
  const byId = new Map()
  for (const entry of payload?.data ?? []) {
    const thumb = entry.thumbnails?.[0]
    if (thumb?.state === 'Completed' && thumb.imageUrl) byId.set(entry.universeId, thumb.imageUrl)
  }
  return batch.filter((g) => byId.has(g.universeId)).map((g) => ({ ...g, thumbnailUrl: byId.get(g.universeId) }))
}

// A Roblox game page holds at most 10 thumbnails; ask for room to spare.
const THUMBS_PER_GAME = 20

/** Every finished 16:9 thumbnail on one game's page, in the game's own order. */
export async function gameThumbnails(universeId) {
  const payload = await getJson(
    `${THUMBS_URL}?universeIds=${universeId}&countPerUniverse=${THUMBS_PER_GAME}&defaults=true&size=768x432&format=Png&isCircular=false`
  )
  const entry = (payload?.data ?? []).find((d) => d.universeId === universeId)
  return (entry?.thumbnails ?? []).filter((t) => t.state === 'Completed' && t.imageUrl).map((t) => t.imageUrl)
}

const STOP_WORDS = new Set(
  'a an and the of or to in on at for with by from is are be it my your our you me i this that who where game games roblox obby simulator tycoon new upd update read desc beta legacy edition thumbnail thumbnails image picture'.split(
    ' '
  )
)

const stem = (word) => (word.length > 3 ? word.replace(/ies$/, 'y').replace(/s$/, '') : word)

/** Meaningful words of a name: lowercased, accents and emoji dropped, plurals folded. */
export function nameTokens(name) {
  const words = String(name ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
  return [...new Set(words.map(stem))]
}

/** Same word, or one word extending another of 4+ letters (bake: baker, bakery; throw: throwing). Not "pancake" for "cake". */
export function sameWord(a, b) {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 4 && long.startsWith(short)
}

/** A title with Roblox decoration removed: [🎃] tags, (READ DESC), emoji, quotes, dashes, trailing punctuation. */
export function cleanTitle(value) {
  return String(value ?? '')
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, ' ')
    .replace(/["“”]/g, ' ')
    .replace(/\s*[—–]\s*|\s+-{1,2}\s+/g, ' ')
    .replace(/[:|•★☆]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s'`.,;!?]+|[\s'`.,;!?]+$/g, '')
}

// "roblox.com/games/107778070777162/Steal-An-Egg", any subdomain or locale, with the rest of the URL.
const GAME_LINK = /(?:https?:\/\/)?(?:[a-z]+\.)?roblox\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?games\/(\d+)(?:\/([^\s/?#]*))?\S*/i
const PLACE_ID_LINK = /(?:https?:\/\/)?(?:[a-z]+\.)?roblox\.com\/\S*?[?&]placeId=(\d+)\S*/i

/** The first roblox.com game link in the text: its place id, its name slug (or null) and the exact link text. */
export function findGameLink(text) {
  const link = text.match(GAME_LINK)
  if (link) {
    const slug = link[2] && link[2].toLowerCase() !== 'unnamed' ? link[2] : null
    return { placeId: link[1], slug, raw: link[0] }
  }
  const byQuery = text.match(PLACE_ID_LINK)
  return byQuery ? { placeId: byQuery[1], slug: null, raw: byQuery[0] } : null
}

const MINOR_WORDS = new Set('a an and as at but by for from in nor of on or the to vs with'.split(' '))

/** A link's name slug as a title: "Steal-An-Egg" is "Steal an Egg"; all-caps and mixed-case words keep their case. */
export function titleFromSlug(slug) {
  let text = slug
  try {
    text = decodeURIComponent(slug)
  } catch (err) {
    // A malformed %-escape: the slug is still readable as typed.
    console.warn(`Undecodable Roblox slug "${slug}":`, err.message)
  }
  const words = text.split(/[-_+\s]+/).filter(Boolean)
  return words
    .map((word, i) => {
      const lower = word.toLowerCase()
      if (i > 0 && MINOR_WORDS.has(lower)) return lower
      return word === lower ? word[0].toUpperCase() + word.slice(1) : word
    })
    .join(' ')
}

/** Name, description, live player count and lifetime visits for each universe id. */
export async function gameDetails(universeIds) {
  if (universeIds.length === 0) return []
  const payload = await getJson(`${GAMES_URL}?universeIds=${universeIds.join(',')}`)
  return (payload?.data ?? []).map((d) => ({
    universeId: d.id,
    placeId: d.rootPlaceId,
    name: d.name ?? '',
    description: d.description ?? '',
    playing: d.playing ?? 0,
    visits: d.visits ?? 0,
    url: `https://www.roblox.com/games/${d.rootPlaceId}`
  }))
}

// Universes per games request; Roblox refuses long lists.
const DETAILS_BATCH = 50

/** Adds lifetime `visits` to each game, one request per DETAILS_BATCH games. */
export async function withVisits(games) {
  const visits = new Map()
  for (let i = 0; i < games.length; i += DETAILS_BATCH) {
    for (const d of await gameDetails(games.slice(i, i + DETAILS_BATCH).map((g) => g.universeId))) visits.set(d.universeId, d.visits)
  }
  return games.map((g) => (visits.has(g.universeId) ? { ...g, visits: visits.get(g.universeId) } : g))
}

/** The game a roblox.com link points at. */
export async function gameFromPlace(placeId) {
  const res = await fetch(`${PLACE_UNIVERSE_URL}/${placeId}/universe`, { headers: HEADERS, signal: AbortSignal.timeout(15000) })
  const universeId = res.ok ? (await res.json())?.universeId : null
  if (!universeId) throw new GameNotFound(`That Roblox link (place ${placeId}) does not lead to a game. Check the link or type the game's name.`)
  const [game] = await gameDetails([universeId])
  if (!game) throw new GameNotFound(`Roblox has no details for the game at place ${placeId}.`)
  return game
}

const REFERENCE_HOST = /(^|\.)rbxcdn\.com$/

/** Only Roblox CDN images may be fetched as a reference. */
export function isAllowedReferenceUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && REFERENCE_HOST.test(url.hostname)
  } catch {
    // An unparseable string is simply not an allowed URL.
    return false
  }
}

export async function downloadThumbnail(url) {
  if (!isAllowedReferenceUrl(url)) throw new Error('Reference must be a Roblox CDN image.')
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Roblox thumbnail download failed: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  return { bytes, mimeType: imageMimeType(bytes, res.headers.get('content-type')) }
}
