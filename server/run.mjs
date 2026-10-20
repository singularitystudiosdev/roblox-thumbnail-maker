// One run: the game name, then two thumbnails with Nano Banana 2.1, the judge,
// told what the game is (judgeContext), and the winner's icon. Thumbnail 1, the
// meta, sends the plain template with the cleanest thumbnail of the nearest
// popular Roblox game; thumbnail 2 sends the novel perspective remix prompt
// with that same thumbnail. When the prompt links the creator's own game, that
// game's thumbnail is the reference for both, with no Roblox searches. When the
// creator attaches an image and the prompt asks to use it as the reference
// (attached.mjs), thumbnail 2 is their prompt exactly as typed, sent with that
// image. With no popular Roblox game to start from, the meta takes the style
// image, and the remix, whose prompt names no game and would only remake the
// style image, gives way to the exact template on the style image.
// Each step is reported through `emit` as it lands and saved under outputs/<id>/.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { planAttachedSlots, readAttachedIntent } from './attached.mjs'
import { resolveGameName } from './gamename.mjs'
import { imageMimeType } from './mime.mjs'
import { generateThumbnail } from './imagegen.mjs'
import { imageModel } from './imagemodels.mjs'
import { makeIcon } from './icon.mjs'
import { judgeContext, judgeThumbnails } from './judge.mjs'
import { findNearestPopular } from './nearest.mjs'
import { buildPrompt, PLAIN_TEMPLATE, REMIX_PROMPT } from './prompt.mjs'
import { pickCleanestThumbnail } from './cleanest.mjs'
import { gameFromPlace, withThumbnails } from './roblox.mjs'

const EXT = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }
const extOf = (mimeType) => EXT[mimeType] ?? 'png'

export const RUN_ID = /^[0-9TZ-]+-[0-9a-f]{8}$/

function newRunId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
}

/** The meta: the plain template, sent with the Roblox reference's thumbnail (the style image when there is none). */
export const metaSlot = (gameName, slot = 1) => ({ slot, strategy: 'meta', prompt: buildPrompt(gameName, PLAIN_TEMPLATE) })

/** The two thumbnails of every run without an attached reference: the meta, then the novel perspective remix. */
export function planSlots(gameName) {
  return [metaSlot(gameName), { slot: 2, strategy: 'remix', prompt: REMIX_PROMPT }]
}

/** Strategies sent with the Roblox reference's thumbnail. */
export const ON_ROBLOX_REFERENCE = new Set(['remix', 'meta'])

export const NO_ROBLOX_FALLBACK = 'No popular Roblox game to remix, so the exact template on the style image instead.'

/**
 * The slots once the Roblox reference is known: with none, a remix (its prompt names no game, so it would only
 * remake the style image) becomes the exact template on the style image, in the same place.
 */
export function slotsForReference(slots, gameName, hasRobloxImage) {
  if (hasRobloxImage) return slots
  return slots.map((slot) => (slot.strategy === 'remix' ? { slot: slot.slot, strategy: 'template', prompt: buildPrompt(gameName), fallback: NO_ROBLOX_FALLBACK } : slot))
}

/** The linked game's details and its cleanest thumbnail, the reference for both slots of a linked run. */
async function linkedReference(link, gameName) {
  const game = await gameFromPlace(link.placeId)
  const [withThumbnail] = await withThumbnails([game])
  return { game, picked: await pickCleanestThumbnail(withThumbnail ?? game, gameName) }
}

async function nearestOrNull(gameName, extraNames) {
  try {
    return await findNearestPopular(gameName, { extraNames })
  } catch (err) {
    console.error(`Nearest Roblox game lookup for "${gameName}" failed:`, err)
    return null
  }
}

/** The nearest popular game's cleanest thumbnail, saved as record.reference; null when there is none (the style reference stands in). */
async function nearestReferenceInto({ record, gameName, link, style, styleRef, save, emit }) {
  const nearest = await nearestOrNull(gameName, link ? [link.title] : [])
  let image = null
  if (nearest) {
    try {
      image = await pickCleanestThumbnail(nearest, gameName)
      record.reference = {
        source: 'roblox',
        ...nearest,
        robloxThumbnailUrl: image.url,
        thumbnail: { index: image.index, count: image.count, why: image.why, pickedBy: image.pickedBy },
        imageUrl: save('reference', image)
      }
    } catch (err) {
      console.error(`Reference thumbnail for "${nearest.name}" failed:`, err)
    }
  }
  record.reference ??= { source: 'style', name: style.name, imageUrl: styleRef.imageUrl }
  emit({ type: 'reference', reference: record.reference })
  return image
}

/** The linked game's own thumbnail, saved as record.reference; a failure ends the run (see below). */
async function linkedReferenceInto({ record, gameName, link, save, emit }) {
  let linkedGame
  try {
    linkedGame = await linkedReference(link, gameName)
  } catch (err) {
    // The remix names no game, so the style reference in its place would remake someone else's thumbnail.
    console.error(`The linked game's thumbnail for "${gameName}" failed:`, err)
    throw new Error(`Could not load your linked game's thumbnail, so there is nothing to remake: ${err.message}`, { cause: err })
  }
  const { game, picked } = linkedGame
  record.reference = {
    source: 'roblox',
    linked: true,
    universeId: game.universeId,
    placeId: game.placeId,
    name: game.name,
    playing: game.playing,
    url: game.url,
    why: 'Your linked game: both thumbnails start from its own thumbnail.',
    robloxThumbnailUrl: picked.url,
    thumbnail: { index: picked.index, count: picked.count, why: picked.why, pickedBy: picked.pickedBy },
    imageUrl: save('reference', picked)
  }
  emit({ type: 'reference', reference: record.reference })
  return picked
}

/**
 * `style`: { bytes, mimeType, name, source: 'bundled' | 'upload' }, the image
 * the meta falls back to with no Roblox reference; `attachment`: { bytes, mimeType, name }
 * attached in the prompt box, or null; `model`: the image model every slot
 * uses (imageModel(): Nano Banana 2.1); `intent` reads whether the prompt asks
 * for the attachment (swappable in tests); `withIcon`: false skips the
 * winner's icon (debug runs). Returns the saved run record.
 */
export async function runThumbnails({
  input,
  style,
  attachment = null,
  outputsDir,
  emit = () => {},
  random = Math.random,
  model = imageModel(),
  intent = readAttachedIntent,
  withIcon = true
}) {
  const started = Date.now()
  // An attached image is the reference only when the prompt asks for it; then the game is named without those words.
  const asked = attachment ? await intent(input) : null
  const attached = asked?.useAsReference ? attachment : null
  const { gameName, namedBy, link } = await resolveGameName(attached ? asked.gameText : input)
  // A link that is the game itself (not one cited in a description) makes that game the reference for both slots.
  const linked = !attached && link != null && namedBy === 'link'
  const id = newRunId()
  const dir = join(outputsDir, id)
  mkdirSync(dir, { recursive: true })
  const save = (name, image) => {
    const file = `${name}.${extOf(image.mimeType)}`
    writeFileSync(join(dir, file), image.bytes)
    return `/outputs/${id}/${file}`
  }

  const styleRef = { name: style.name, source: style.source, imageUrl: save('style', style) }
  const record = {
    id,
    createdAt: new Date().toISOString(),
    input,
    gameName,
    namedBy,
    link,
    mode: attached ? 'attached' : linked ? 'linked' : 'standard',
    attachment: attachment ? { name: attachment.name, imageUrl: save('attached', attachment), used: Boolean(attached), readBy: asked.readBy } : null,
    style: styleRef,
    imageModel: { key: model.key, label: model.label },
    reference: null,
    slots: attached ? planAttachedSlots(input, gameName) : planSlots(gameName),
    thumbnails: [],
    judge: null
  }
  emit({ type: 'plan', run: record })

  const images = new Map()
  const generate = async (slot, referenceImage, referenceName) => {
    const t0 = Date.now()
    const base = { slot: slot.slot, strategy: slot.strategy, prompt: slot.prompt, referenceName, ...(slot.fallback ? { fallback: slot.fallback } : {}) }
    try {
      const image = await generateThumbnail(slot.prompt, referenceImage, model)
      images.set(slot.slot, image)
      return { ...base, imageUrl: save(`thumbnail-${slot.slot}`, image), provider: image.provider, model: image.model, ms: Date.now() - t0 }
    } catch (err) {
      console.error(`Thumbnail ${slot.slot} failed:`, err)
      return { ...base, error: err.message, ms: Date.now() - t0 }
    }
  }
  const draw = (slot, image, name) =>
    generate(slot, image, name).then((thumbnail) => {
      record.thumbnails.push(thumbnail)
      emit({ type: 'thumbnail', thumbnail })
      return thumbnail
    })

  const ctx = { record, gameName, link, style, styleRef, save, emit }
  // The creator's own image needs no lookup, so their typed prompt starts at once.
  const typed = record.slots.filter((slot) => slot.strategy === 'typed').map((slot) => draw(slot, attachment, attachment.name))
  const robloxImage = await (linked ? linkedReferenceInto(ctx) : nearestReferenceInto(ctx))
  const planned = slotsForReference(record.slots, gameName, robloxImage != null)
  if (planned !== record.slots) {
    record.slots = planned
    emit({ type: 'slots', slots: record.slots })
  }
  const onReference = record.slots
    .filter((slot) => slot.strategy !== 'typed')
    .map((slot) => (robloxImage && ON_ROBLOX_REFERENCE.has(slot.strategy) ? draw(slot, robloxImage, record.reference.name) : draw(slot, style, style.name)))
  await Promise.all([...typed, ...onReference])
  record.thumbnails.sort((a, b) => a.slot - b.slot)

  const finished = record.thumbnails.filter((t) => images.has(t.slot)).map((t) => ({ slot: t.slot, ...images.get(t.slot) }))
  if (finished.length > 0) {
    emit({ type: 'judging' })
    await judgeInto(record, dir, finished, random)
    emit({ type: 'judge', judge: record.judge })
  }
  if (record.judge && withIcon) await iconForWinner(record, dir, model, { emit })
  record.winnerSlot ??= null
  record.ms = Date.now() - started
  writeFileSync(join(dir, 'run.json'), JSON.stringify(record, null, 2))
  emit({ type: 'done', run: record })
  return record
}

/** Judges `finished` thumbnails with the game's context; a failed judge is recorded, never thrown. */
async function judgeInto(record, dir, finished, random = Math.random) {
  try {
    const context = await judgeContext(record, dir).catch((err) => {
      console.error('Game context for the judge failed; judging on the name alone:', err)
      return null
    })
    record.judge = await judgeThumbnails(record.gameName, finished, { random, context })
  } catch (err) {
    console.error('Judging failed:', err)
    record.judge = { error: err.message, winnerSlot: null }
  }
  record.winnerSlot = record.judge.winnerSlot ?? null
}

/**
 * The winner's square Roblox icon (icon.mjs), drawn by the run's image model
 * once the judge has picked; a winner that has one keeps it, and a failed icon
 * leaves the run standing. `icon` is swappable in tests.
 */
async function iconForWinner(record, dir, model, { emit = () => {}, icon = makeIcon } = {}) {
  const winner = record.thumbnails.find((t) => t.slot === record.winnerSlot && t.imageUrl)
  if (!winner || winner.iconUrl) return
  try {
    const bytes = readFileSync(join(dir, basename(winner.imageUrl)))
    const made = await icon({ bytes, mimeType: imageMimeType(bytes) }, model)
    const file = `icon-${winner.slot}.png`
    writeFileSync(join(dir, file), made.bytes)
    winner.iconUrl = `/outputs/${record.id}/${file}`
    winner.iconRedrawn = made.redrawn
    emit({ type: 'icon', slot: winner.slot, iconUrl: winner.iconUrl, iconRedrawn: made.redrawn })
  } catch (err) {
    console.error(`Icon for the winner, thumbnail ${winner.slot}, failed:`, err)
  }
}

/**
 * Judges a saved run again with the current judge and saves the new verdict,
 * with an icon for a new winner that has none. `icon` is swappable in tests.
 */
export async function rejudgeRun(outputsDir, id, { icon = makeIcon } = {}) {
  const dir = join(outputsDir, id)
  if (!RUN_ID.test(id) || !existsSync(join(dir, 'run.json'))) return null
  const record = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'))
  const finished = record.thumbnails
    .filter((t) => t.imageUrl)
    .map((t) => {
      const bytes = readFileSync(join(dir, basename(t.imageUrl)))
      return { slot: t.slot, bytes, mimeType: imageMimeType(bytes) }
    })
  if (finished.length === 0) return record
  await judgeInto(record, dir, finished)
  await iconForWinner(record, dir, imageModel(), { icon })
  writeFileSync(join(dir, 'run.json'), JSON.stringify(record, null, 2))
  return record
}

/**
 * Saves the creator's own winner for a run (null clears it); `accept` lists every slot they would
 * take as the winner, when more than one. The judge sees saved picks as worked examples
 * (judge.mjs pickLibrary). Null when there is no such run or slot.
 */
export function pickWinner(outputsDir, id, slot, accept = null) {
  const dir = join(outputsDir, id)
  if (!RUN_ID.test(id) || !existsSync(join(dir, 'run.json'))) return null
  const record = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'))
  if (slot != null && !record.thumbnails.some((t) => t.slot === slot && t.imageUrl)) return null
  const also = (accept ?? []).filter((s) => s !== slot && record.thumbnails.some((t) => t.slot === s && t.imageUrl))
  record.userPick = slot == null ? null : { slot, ...(also.length ? { accept: [slot, ...also] } : {}), at: new Date().toISOString() }
  writeFileSync(join(dir, 'run.json'), JSON.stringify(record, null, 2))
  return record
}

/** Every saved run, newest first; `limit` caps it (none by default: history shows every run). */
export function listRuns(outputsDir, limit = Infinity) {
  return readdirSync(outputsDir)
    .filter((name) => RUN_ID.test(name) && existsSync(join(outputsDir, name, 'run.json')))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((name) => JSON.parse(readFileSync(join(outputsDir, name, 'run.json'), 'utf8')))
}
