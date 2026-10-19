// The judge: a vision model sees the finished thumbnails with the game name and
// what the game really is (its Roblox description, and its current thumbnail
// when the creator linked it), scores each on a Roblox rubric led by "shows
// this game", and picks one. Each pass shows the thumbnails in a fresh shuffled
// order labelled by position ("Image 1" is simply the first image, so the model
// never has to map labels to images); code maps positions back to slots.
// Several passes vote, so neither order nor one sample decides.
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { askJson, judgeRoutes, withoutDashes } from './llm.mjs'
import { imageMimeType } from './mime.mjs'
import { downloadThumbnail, gameDetails, gameFromPlace, gameThumbnails } from './roblox.mjs'

export const CRITERIA = ['fitsGame', 'genreLook', 'clean', 'clickable', 'coherent']
export const MAX_TOTAL = CRITERIA.length * 10
export const PASSES = 3
const PASS_STAGGER_MS = 1000
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const DESCRIPTION_LIMIT = 700

export const JUDGE_SYSTEM = `You judge Roblox game thumbnails for a creator. A good Roblox thumbnail lets a player scrolling past at small size understand the game at a glance and want to click it, and it never misleads them about what the game is.
You get the creator's game (its name, or their description of it), context about the game, and candidate thumbnails labelled Image 1, Image 2 and so on by their position, in no particular order.
Look closely at the whole of every image, its edges and corners included, before you score it.
Score every candidate from 1 to 10 on:
- fitsGame: it shows this game: its gameplay, characters, objects and setting as the name and the context describe them. A picture of a different setting, genre or story (for example a space battle for a farming game) misleads players: score it 1 to 3 however polished it is. Illustrating the words of the name literally is not enough when the context shows the game is something else. Once a thumbnail clearly shows the game it scores 9 or 10: more props, more characters or more of the name's items never earn a higher fitsGame than another thumbnail that clearly shows the game too.
- genreLook: it has the render style that wins for this kind of Roblox game, which the context gives (the game's own thumbnail, or the look of a popular game of its kind): a tactical shooter wins with realistic, cinematic renders, a simulator or obby with chunky, glossy cartoon ones. Match the render style and realism level only; the color palette and warm or cold lighting are free choices and never count against a thumbnail. Never judge against one house style. Roblox avatars in a Roblox-built world either way; flat 2D drawings and photos of real people score low. Within one render family, small differences in polish, texture or realism are equal genreLook.
- clean: the picture fills the whole 16:9 frame edge to edge; white or blank corners, borders or a picture pasted inside a frame make a broken thumbnail, so score clean 1 to 3. A dark vignette that is part of the scene (a scope, night vision goggles, a camera or a flashlight view) is a deliberate effect, not a broken frame. Also no words anywhere (on screen, on signs or on clothing), no watermarks or artifacts. Small comic symbols such as zzz, arrows or exclamation marks barely matter.
- clickable: at feed size (about 256 by 144 pixels) it stops a scrolling player. Big and close beats small and complete: the main subject and the game's signature objects shown large and close to the camera, filling the frame with strong depth between foreground and background, beat a flat or distant scene that shows everything small. A view that puts the player inside the action (over the shoulder, point of view, a low or high angle, a scope or camera view) is striking, and a character seen from behind is fine in such a view. One dominant subject beats several medium-size ones, and a busy scene full of props reads worse than one subject with a few big props. When the context shows the game's current thumbnail, a candidate that nearly repeats it adds nothing new and is less clickable than a fresh view of the same game. Score clickable by the main subject: one character or object large and close to the camera, about a third of the frame height or more, with a few big props, scores 8 to 10; two or more characters of similar medium size side by side, or props piled across the frame, score at most 6.
- coherent: nothing is broken: warped bodies, duplicated or floating objects (such as two of the same tool, or a tool with no hand), impossible objects. A deliberate camera angle such as top down, close up, high angle or profile is not a flaw.
Pick the winner: fitsGame decides first, because a thumbnail that misleads players cannot win. Among the thumbnails that fit the game, pick the one the most players would click: clickable counts most, then genreLook, clean and coherent. Showing more of the name's items or a busier scene never wins over a bolder thumbnail with one dominant subject.
Refer to candidates only as "Image" and their number. Write each note and the reason as one or two plain sentences without dashes.
Reply as JSON: {"scores":[{"image":1,"fitsGame":1,"genreLook":1,"clean":1,"clickable":1,"coherent":1,"note":"..."}],"winner":1,"reason":"..."}`

const SCORE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    image: { type: 'INTEGER' },
    ...Object.fromEntries(CRITERIA.map((c) => [c, { type: 'INTEGER' }])),
    note: { type: 'STRING' }
  },
  required: ['image', ...CRITERIA, 'note']
}

const JUDGE_SCHEMA = {
  type: 'OBJECT',
  properties: { scores: { type: 'ARRAY', items: SCORE_SCHEMA }, winner: { type: 'INTEGER' }, reason: { type: 'STRING' } },
  required: ['scores', 'winner', 'reason']
}

/** A Fisher-Yates shuffle of a copy. */
export function shuffled(items, random = Math.random) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const clampScore = (value) => Math.min(10, Math.max(1, Math.round(Number(value) || 1)))
const imageNumber = (value) => Number(String(value ?? '').match(/\d+/)?.[0])

/** "Image 2" in the model's words becomes the slot shown second ("Thumbnail 3"); "Images 1 and 2" maps each number. */
export function renumber(text, order) {
  const list = /\bimage(s?)\s+(\d+(?:(?:\s*,\s*|\s+and\s+|\s*&\s*)\d+)*)\b/gi
  return withoutDashes(text).replace(list, (match, plural, numbers) => {
    if (numbers.match(/\d+/g).some((n) => !order[n - 1])) return match
    return `Thumbnail${plural} ${numbers.replace(/\d+/g, (n) => order[n - 1])}`
  })
}

/** One pass's verdict, image positions mapped back to slots; a winner it did not name validly is the top total. */
export function readVerdict(value, order) {
  const slotAt = (n) => order[n - 1] ?? null
  const scores = []
  for (const row of Array.isArray(value?.scores) ? value.scores : []) {
    const slot = slotAt(imageNumber(row?.image))
    if (!slot || scores.some((s) => s.slot === slot)) continue
    const marks = Object.fromEntries(CRITERIA.map((c) => [c, clampScore(row[c])]))
    scores.push({ slot, ...marks, total: CRITERIA.reduce((sum, c) => sum + marks[c], 0), note: renumber(row.note, order) })
  }
  scores.sort((a, b) => a.slot - b.slot)
  const named = slotAt(imageNumber(value?.winner))
  const top = scores.reduce((best, s) => (best && best.total >= s.total ? best : s), null)
  const winnerSlot = named ?? top?.slot ?? null
  if (!winnerSlot) throw new Error('The judge named no winner and scored no thumbnail.')
  return { winnerSlot, reason: renumber(value?.reason, order), scores, winnerFrom: named ? 'judge' : 'top score' }
}

// Below this mean fitsGame a thumbnail misleads players about the game and cannot win on its other marks.
export const FITS_GAME_MIN = 5

/**
 * Scores are each slot's mean over the passes. The winner is the judge's own
 * pick: the thumbnail most passes chose, among those that fit the game (all of
 * them when none does). The summed marks miss what makes one of several good
 * thumbnails stand out, so they only break a tie in votes, or decide when no
 * pass chose a thumbnail that fits.
 */
export function combinePasses(passes) {
  const votes = new Map()
  for (const pass of passes) votes.set(pass.winnerSlot, (votes.get(pass.winnerSlot) ?? 0) + 1)
  const slots = [...new Set(passes.flatMap((p) => p.scores.map((s) => s.slot)))].sort((a, b) => a - b)
  const scores = slots.map((slot) => {
    const rows = passes.flatMap((p) => p.scores.filter((s) => s.slot === slot))
    const mean = (key) => Math.round((rows.reduce((sum, r) => sum + r[key], 0) / rows.length) * 10) / 10
    const voted = passes.find((p) => p.winnerSlot === slot) ?? passes[0]
    return { slot, ...Object.fromEntries([...CRITERIA, 'total'].map((k) => [k, mean(k)])), note: voted.scores.find((s) => s.slot === slot)?.note ?? rows[0].note }
  })
  const fitting = scores.filter((s) => s.fitsGame >= FITS_GAME_MIN)
  const rank = (s) => [votes.get(s.slot) ?? 0, s.total]
  const best = (fitting.length > 0 ? fitting : scores).reduce((a, b) => {
    const [va, ta] = rank(a)
    const [vb, tb] = rank(b)
    return vb > va || (vb === va && tb > ta) ? b : a
  })
  const winnerSlot = best.slot
  const reason = passes.find((p) => p.winnerSlot === winnerSlot)?.reason ?? `Thumbnail ${winnerSlot} scored best across the judge's passes. ${best.note}`
  return { winnerSlot, reason, scores, votes: Object.fromEntries(votes), maxTotal: MAX_TOTAL, minFitsGame: FITS_GAME_MIN }
}

const tidy = (text) => String(text ?? '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()

/** A game's first thumbnail on its Roblox page, or null when it has none. */
async function firstThumbnail(universeId) {
  const [url] = await gameThumbnails(universeId)
  return url ? downloadThumbnail(url) : null
}

const savedImage = (dir, imageUrl) => {
  const bytes = readFileSync(join(dir, basename(imageUrl)))
  return { bytes, mimeType: imageMimeType(bytes) }
}

/** The creator's linked game: its description and current thumbnail (the saved reference when it is that game). */
async function ownGameContext(run, dir, place, thumbnailOf) {
  const game = await place(run.link.placeId)
  const ref = run.reference
  const isReference = ref?.source === 'roblox' && String(ref.universeId) === String(game.universeId)
  let image = null
  try {
    image = isReference ? savedImage(dir, ref.imageUrl) : await thumbnailOf(game.universeId)
  } catch (err) {
    console.error(`Thumbnail of "${game.name}" for the judge failed; judging on its description:`, err)
  }
  return { own: true, name: game.name, playing: game.playing ?? 0, description: tidy(game.description).slice(0, DESCRIPTION_LIMIT), image }
}

const LOOK_SYSTEM = `You describe the visual look of a Roblox game thumbnail so a judge can match other thumbnails to it.
In at most 10 words, give its render style and realism level only, for example "realistic, cinematic 3D render" or "chunky, glossy cartoon 3D render" or "flat 2D drawing".
Never describe colors, lighting, the scene, characters, objects or story. Use no dashes.
Reply as JSON: {"look": "..."}`

const LOOK_SCHEMA = { type: 'OBJECT', properties: { look: { type: 'STRING' } }, required: ['look'] }

/** A popular game's thumbnail as words for its look, so the judge can match the look without a scene to copy. */
async function describeLook(image) {
  const { value } = await askJson(
    { label: 'Reference look', system: LOOK_SYSTEM, user: 'The thumbnail follows.', images: [{ label: 'Thumbnail', ...image }], schema: LOOK_SCHEMA },
    judgeRoutes()
  )
  return withoutDashes(value.look).slice(0, 120)
}

/**
 * What the judge is told the game is. A linked game is the creator's own: its
 * description and current thumbnail, whichever game the remixes started from.
 * Otherwise the popular reference game's name, description and the look of its
 * thumbnail in words: shown its image, the judge rewarded remixes that copied
 * its scene. Null when there is neither.
 */
export async function judgeContext(
  run,
  dir,
  { details = gameDetails, place = gameFromPlace, thumbnailOf = firstThumbnail, lookOf = describeLook } = {}
) {
  if (run.link) {
    try {
      return await ownGameContext(run, dir, place, thumbnailOf)
    } catch (err) {
      console.error(`The linked game for the judge failed; falling back to the reference game:`, err)
    }
  }
  const ref = run.reference
  if (ref?.source !== 'roblox') return null
  let description = ''
  try {
    description = tidy((await details([ref.universeId]))[0]?.description).slice(0, DESCRIPTION_LIMIT)
  } catch (err) {
    console.error(`Description of "${ref.name}" for the judge failed:`, err)
  }
  let look = ''
  try {
    look = await lookOf(savedImage(dir, ref.imageUrl))
  } catch (err) {
    console.error(`The look of "${ref.name}" for the judge failed; judging on its description:`, err)
  }
  return { own: false, name: ref.name, playing: ref.playing ?? 0, description, look, image: null }
}

/** The judge's user message for one pass. */
export function judgeRequest(gameName, count, context) {
  const lines = [`The creator's game: ${gameName}`]
  const about = context?.description ? ` Its Roblox description: "${context.description}"` : ''
  if (context?.own) {
    lines.push(`Context: this is the creator's own game on Roblox, "${context.name}", with ${context.playing} playing now.${about}`)
    if (context.image) {
      lines.push(`The last image is its current Roblox thumbnail, attached so you know what the game looks like. It is context, not a candidate.`)
    }
  } else if (context) {
    lines.push(
      `Context: the most played Roblox game like the creator's is "${context.name}", with ${context.playing} playing now.${about}`,
      `It is a different game: use it only to understand this kind of game and the look its players click on, not as the creator's game.`
    )
    if (context.look) lines.push(`The render style its thumbnail wins with: ${context.look}. Judge genreLook against that render style.`)
  }
  lines.push(`Candidates: ${Array.from({ length: count }, (_, i) => `Image ${i + 1}`).join(', ')}.`)
  return lines.join('\n\n')
}

async function judgeOnce(gameName, entries, context, random, system) {
  const order = shuffled(entries, random)
  const images = order.map((entry, i) => ({ label: `Image ${i + 1}`, mimeType: entry.mimeType, bytes: entry.bytes, url: entry.sourceUrl }))
  if (context?.image) images.push({ label: "The game's current thumbnail (context, not a candidate)", ...context.image })
  const { value, provider, model } = await askJson(
    { label: 'Thumbnail judge', system, user: judgeRequest(gameName, order.length, context), images, schema: JUDGE_SCHEMA },
    judgeRoutes()
  )
  const slots = order.map((entry) => entry.slot)
  return { ...readVerdict(value, slots), order: slots, provider, model }
}

/**
 * `entries`: [{ slot, bytes, mimeType }] for the thumbnails that generated;
 * `context`: from judgeContext, or null. Returns { winnerSlot, reason, scores,
 * votes, passes, maxTotal, provider, model }.
 */
export async function judgeThumbnails(gameName, entries, { random = Math.random, context = null, passes = PASSES, system = JUDGE_SYSTEM } = {}) {
  if (entries.length === 1) {
    return { winnerSlot: entries[0].slot, reason: 'The only thumbnail that generated.', scores: [], maxTotal: MAX_TOTAL, provider: null, model: null }
  }
  // Passes start a second apart: fal refuses a burst of image-heavy requests landing at once.
  const settled = await Promise.allSettled(
    Array.from({ length: passes }, (_, i) => delay(i * PASS_STAGGER_MS).then(() => judgeOnce(gameName, entries, context, random, system)))
  )
  const done = settled.flatMap((outcome, i) => {
    if (outcome.status === 'fulfilled') return [outcome.value]
    console.error(`Judge pass ${i + 1} of ${passes} failed:`, outcome.reason)
    return []
  })
  if (done.length === 0) throw settled[0].reason
  const combined = combinePasses(done)
  return {
    ...combined,
    context: context ? { own: context.own, name: context.name, withImage: context.image != null } : null,
    passes: done.map(({ winnerSlot, order, scores }) => ({ winnerSlot, order, totals: Object.fromEntries(scores.map((s) => [s.slot, s.total])) })),
    provider: done[0].provider,
    model: done[0].model
  }
}
