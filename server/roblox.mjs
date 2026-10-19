// Public Roblox endpoints: omni-search for games, multiget for their 16:9
// thumbnails, and the rule that picks the style reference: of the top search
// results whose names share a word with the game name, the one with the most
// players online right now (CCU).
import { randomUUID } from 'node:crypto'

const SEARCH_URL = 'https://apis.roblox.com/search-api/omni-search'
const THUMBS_URL = 'https://thumbnails.roblox.com/v1/games/multiget/thumbnails'
const HEADERS = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 roblox-thumbnail-maker' }

// Relevance-ordered results considered at all; Roblox mixes unrelated hits
// (Steal An Egg for "Grow a Garden") into the list, so the word check below
// decides which of these count as near. A name nothing shares a word with gets
// no Roblox reference: for such names search returns generic hits (Brookhaven).
export const SEARCH_DEPTH = 20

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

/** Adds `thumbnailUrl` to each game; games whose thumbnail is not ready are dropped. */
export async function withThumbnails(games) {
  if (games.length === 0) return []
  const ids = games.map((g) => g.universeId).join(',')
  const payload = await getJson(
    `${THUMBS_URL}?universeIds=${ids}&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false`
  )
  const byId = new Map()
  for (const entry of payload?.data ?? []) {
    const thumb = entry.thumbnails?.[0]
    if (thumb?.state === 'Completed' && thumb.imageUrl) byId.set(entry.universeId, thumb.imageUrl)
  }
  return games.filter((g) => byId.has(g.universeId)).map((g) => ({ ...g, thumbnailUrl: byId.get(g.universeId) }))
}

const STOP_WORDS = new Set(
  'a an and the of or to in on at for with by from is are be it my your our you me i this that who where game games roblox obby simulator tycoon new upd update read desc beta legacy edition'.split(
    ' '
  )
)

const stem = (word) => (word.length > 3 ? word.replace(/ies$/, 'y').replace(/s$/, '') : word)

/** Meaningful words of a name: lowercased, accents and emoji dropped, plurals folded. */
export function nameTokens(name) {
  const words = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
  return [...new Set(words.map(stem))]
}

// Same word, or one word extending another of 4+ letters (bake: baker, bakery). Not "pancake" for "cake".
function sameWord(a, b) {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 4 && long.startsWith(short)
}

export function isNear(queryTokens, gameName) {
  const tokens = nameTokens(gameName)
  return queryTokens.some((q) => tokens.some((t) => sameWord(q, t)))
}

/** The most played of the near games (ties keep Roblox's order), or null when none is near. */
export function pickReference(query, games) {
  const queryTokens = nameTokens(query)
  const near = queryTokens.length ? games.filter((g) => isNear(queryTokens, g.name)) : []
  const game = near.reduce((best, g) => (best && best.playing >= g.playing ? best : g), null)
  return game ? { game, nearCount: near.length } : null
}

/** Searches Roblox for the game name and returns the reference game, or null when nothing usable comes back. */
export async function findReference(gameName) {
  const games = await withThumbnails((await searchGames(gameName)).slice(0, SEARCH_DEPTH))
  return pickReference(gameName, games)
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
  return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get('content-type')?.split(';')[0] ?? 'image/png' }
}
