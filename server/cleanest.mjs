// Of all the thumbnails on the nearest game's Roblox page, the one the remixes
// start from: a vision model picks the cleanest and most coherent, with the
// least text and the most true Roblox look. The game's first thumbnail is the
// answer when it has only one, or when no model can look.
import { askJson, judgeRoutes, withoutDashes } from './llm.mjs'
import { downloadThumbnail, gameThumbnails } from './roblox.mjs'

const PICK_SYSTEM = `You choose the reference image for a new Roblox game thumbnail from the thumbnails on one Roblox game's page.
An image model will remix the chosen one into a new thumbnail with no text, so pick the thumbnail that is:
- the cleanest: one clear scene, no clutter, collage borders, watermarks or artifacts;
- the most coherent: characters and objects make visual and physical sense;
- the one with the least text: titles, numbers, logos, badges, arrows with captions and UI all count as text;
- the most true to Roblox style: Roblox avatars in a polished Roblox 3D render, not real photos or flat 2D art.
Refer to a thumbnail as "Thumbnail" and its number. Write the reason as one plain sentence without dashes.
Reply as JSON: {"thumbnail": <number>, "why": "..."}`

const PICK_SCHEMA = {
  type: 'OBJECT',
  properties: { thumbnail: { type: 'INTEGER' }, why: { type: 'STRING' } },
  required: ['thumbnail', 'why']
}

/** The number the model chose, if it is one of the `count` thumbnails shown. */
export function chosenIndex(value, count) {
  const n = Number(String(value?.thumbnail ?? '').match(/\d+/)?.[0])
  return Number.isInteger(n) && n >= 1 && n <= count ? n : null
}

async function downloadAll(urls) {
  const settled = await Promise.allSettled(urls.map((url) => downloadThumbnail(url)))
  return settled.flatMap((outcome, i) => {
    if (outcome.status === 'fulfilled') return [{ url: urls[i], index: i + 1, ...outcome.value }]
    console.error(`Thumbnail ${i + 1} of the reference game failed to download:`, outcome.reason)
    return []
  })
}

/**
 * `game`: a search hit with `universeId` and its first `thumbnailUrl`.
 * Returns { url, bytes, mimeType, index (1-based on the game page), count, why, pickedBy }.
 */
export async function pickCleanestThumbnail(game) {
  let urls = []
  try {
    urls = await gameThumbnails(game.universeId)
  } catch (err) {
    console.error(`Listing the thumbnails of "${game.name}" failed; using its first one:`, err)
  }
  if (urls.length === 0) urls = [game.thumbnailUrl]
  const images = await downloadAll(urls)
  if (images.length === 0) throw new Error(`No thumbnail of "${game.name}" could be downloaded.`)
  const first = { ...images[0], count: urls.length }
  if (images.length === 1) return { ...first, why: 'The only thumbnail on the game page.', pickedBy: null }

  try {
    const { value, model } = await askJson(
      {
        label: 'Cleanest reference thumbnail',
        system: PICK_SYSTEM,
        user: `Game: ${game.name}\n\nThumbnails: ${images.map((img) => `Thumbnail ${img.index}`).join(', ')}. Each image follows its label.`,
        images: images.map((img) => ({ label: `Thumbnail ${img.index}`, mimeType: img.mimeType, bytes: img.bytes })),
        schema: PICK_SCHEMA
      },
      judgeRoutes()
    )
    const index = chosenIndex(value, urls.length)
    const picked = images.find((img) => img.index === index)
    if (picked) return { ...picked, count: urls.length, why: withoutDashes(value.why), pickedBy: model }
    console.warn(`Cleanest thumbnail pick answered ${JSON.stringify(value?.thumbnail)} of ${urls.length}; using the first.`)
  } catch (err) {
    console.error(`Cleanest thumbnail pick for "${game.name}" failed; using its first thumbnail:`, err)
  }
  return { ...first, why: 'The game page lists it first.', pickedBy: 'first on page' }
}
