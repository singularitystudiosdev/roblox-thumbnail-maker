// Of all the thumbnails on the reference game's Roblox page (the nearest popular
// game, or the creator's linked game), the one the meta and the remix start
// from: a random one each run, so the same game gives a new starting point run
// after run. One that fails to download is skipped for another; the search
// hit's own thumbnail stands in when the page lists none.
import { downloadThumbnail, gameThumbnails } from './roblox.mjs'

/**
 * `game`: a search hit with `universeId` and its first `thumbnailUrl`; `random` is swappable in tests.
 * Returns { url, bytes, mimeType, index (1-based on the game page), count, why, pickedBy: 'random' }.
 */
export async function pickRandomThumbnail(game, { random = Math.random } = {}) {
  let urls = []
  try {
    urls = await gameThumbnails(game.universeId)
  } catch (err) {
    console.error(`Listing the thumbnails of "${game.name}" failed; using its search thumbnail:`, err)
  }
  if (urls.length === 0 && game.thumbnailUrl) urls = [game.thumbnailUrl]
  const left = urls.map((url, i) => ({ url, index: i + 1 }))
  while (left.length > 0) {
    const [pick] = left.splice(Math.min(left.length - 1, Math.floor(random() * left.length)), 1)
    try {
      const image = await downloadThumbnail(pick.url)
      const why = urls.length === 1 ? 'The only thumbnail on the game page.' : `Picked at random from the ${urls.length} on the game page.`
      return { ...image, url: pick.url, index: pick.index, count: urls.length, why, pickedBy: 'random' }
    } catch (err) {
      console.error(`Thumbnail ${pick.index} of "${game.name}" failed to download; trying another:`, err)
    }
  }
  throw new Error(`No thumbnail of "${game.name}" could be downloaded.`)
}
