// One run: the game name, then five Nano Banana Pro thumbnails at once
// (1 and 5: the exact and the plain template, each with the style reference;
// 2: the novel perspective remix prompt, and 4: the meta, the plain template,
// each with the cleanest thumbnail of the popular reference game; 3: the
// search meta, the plain template with the top game of a plain Roblox search
// for the name, never the same game as 2 and 4), then the judge, told what the
// game is (judgeContext), then the winner's icon. When the creator attaches an
// image and the prompt asks to use it as the reference (attached.mjs), the run
// makes two thumbnails from that image instead: their prompt as typed and the
// plain template. When the prompt links the creator's game, all five send the
// novel perspective remix prompt with that game's own thumbnail, with no
// Roblox searches.
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
import { buildPrompt, PLAIN_TEMPLATE, REMIX_COUNT, REMIX_PROMPT } from './prompt.mjs'
import { pickCleanestThumbnail } from './cleanest.mjs'
import { gameFromPlace, withThumbnails } from './roblox.mjs'
import { pickSearchTop, rankSearch } from './searchtop.mjs'

const EXT = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }
const extOf = (mimeType) => EXT[mimeType] ?? 'png'

export const RUN_ID = /^[0-9TZ-]+-[0-9a-f]{8}$/

function newRunId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
}

/** The slots of a run and the exact prompt each sends: the template, REMIX_COUNT remixes, the search meta, the meta, then the plain template. */
export function planSlots(gameName) {
  const plain = buildPrompt(gameName, PLAIN_TEMPLATE)
  return [
    { slot: 1, strategy: 'template', prompt: buildPrompt(gameName) },
    ...Array.from({ length: REMIX_COUNT }, (_, i) => ({ slot: i + 2, strategy: 'remix', prompt: REMIX_PROMPT })),
    { slot: REMIX_COUNT + 2, strategy: 'search', prompt: plain },
    { slot: REMIX_COUNT + 3, strategy: 'meta', prompt: plain },
    { slot: REMIX_COUNT + 4, strategy: 'plain', prompt: plain }
  ]
}

/** A linked run: five novel perspective remixes, each with the linked game's own thumbnail. */
export function planLinkedSlots() {
  return Array.from({ length: 5 }, (_, i) => ({ slot: i + 1, strategy: 'remix', prompt: REMIX_PROMPT }))
}

/** The linked game's details and its cleanest thumbnail, the reference for every slot of a linked run. */
async function linkedReference(link, gameName) {
  const game = await gameFromPlace(link.placeId)
  const [withThumbnail] = await withThumbnails([game])
  return { game, picked: await pickCleanestThumbnail(withThumbnail ?? game, gameName) }
}

// Strategies that start from the nearest popular game's thumbnail, and those that start from the style
// reference; 'search' starts from the top game of a plain Roblox search.
export const ON_ROBLOX_REFERENCE = new Set(['remix', 'meta'])
export const ON_STYLE_REFERENCE = new Set(['template', 'plain'])

async function nearestOrNull(gameName, extraNames) {
  try {
    return await findNearestPopular(gameName, { extraNames })
  } catch (err) {
    console.error(`Nearest Roblox game lookup for "${gameName}" failed:`, err)
    return null
  }
}

/**
 * `style`: { bytes, mimeType, name, source: 'bundled' | 'upload' }, the image
 * the two templates are styled after; `attachment`: { bytes, mimeType, name }
 * attached in the prompt box, or null; `model`: the image model every slot
 * uses (imageModel(): Nano Banana Pro); `intent` reads whether the prompt asks
 * for the attachment (swappable in tests). Returns the saved run record.
 */
export async function runThumbnails({
  input,
  style,
  attachment = null,
  outputsDir,
  emit = () => {},
  random = Math.random,
  model = imageModel(),
  intent = readAttachedIntent
}) {
  const started = Date.now()
  // An attached image is the reference only when the prompt asks for it; then the game is named without those words.
  const asked = attachment ? await intent(input) : null
  const attached = asked?.useAsReference ? attachment : null
  const { gameName, namedBy, link } = await resolveGameName(attached ? asked.gameText : input)
  // A link that is the game itself (not one cited in a description) makes that game the reference for every slot.
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
  const slots = attached ? planAttachedSlots(input, gameName) : linked ? planLinkedSlots() : planSlots(gameName)
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
    searchReference: null,
    slots,
    thumbnails: [],
    judge: null
  }
  emit({ type: 'plan', run: record })

  const images = new Map()
  const generate = async (slot, referenceImage, referenceName) => {
    const t0 = Date.now()
    const base = { slot: slot.slot, strategy: slot.strategy, prompt: slot.prompt, referenceName }
    try {
      const image = await generateThumbnail(slot.prompt, referenceImage, model)
      images.set(slot.slot, image)
      return { ...base, imageUrl: save(`thumbnail-${slot.slot}`, image), provider: image.provider, model: image.model, ms: Date.now() - t0 }
    } catch (err) {
      console.error(`Thumbnail ${slot.slot} failed:`, err)
      return { ...base, error: err.message, ms: Date.now() - t0 }
    }
  }
  const report = (thumbnail) => {
    record.thumbnails.push(thumbnail)
    emit({ type: 'thumbnail', thumbnail })
    return thumbnail
  }

  if (attached) {
    // Both thumbnails start from the creator's attached image; no Roblox lookups.
    await Promise.all(slots.map((slot) => generate(slot, attachment, attachment.name).then(report)))
  } else if (linked) {
    // Every thumbnail remakes the linked game's own thumbnail; no Roblox searches.
    let linkedGame
    try {
      linkedGame = await linkedReference(link, gameName)
    } catch (err) {
      // The prompts name no game, so the style reference in its place would remake someone else's thumbnail.
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
      why: 'Your linked game: every thumbnail remakes its own thumbnail from a novel perspective.',
      robloxThumbnailUrl: picked.url,
      thumbnail: { index: picked.index, count: picked.count, why: picked.why, pickedBy: picked.pickedBy },
      imageUrl: save('reference', picked)
    }
    emit({ type: 'reference', reference: record.reference })
    await Promise.all(slots.map((slot) => generate(slot, picked, game.name).then(report)))
  } else {
  const nearestLookup = nearestOrNull(gameName, link ? [link.title] : [])
  // The templates need only the style reference, so they start at once; the Roblox slots wait for their lookups.
  const templates = Promise.all(slots.filter((s) => ON_STYLE_REFERENCE.has(s.strategy)).map((slot) => generate(slot, style, style.name).then(report)))
  const remixes = (async () => {
    const nearest = await nearestLookup
    let referenceImage = style
    if (nearest) {
      try {
        const picked = await pickCleanestThumbnail(nearest, gameName)
        referenceImage = picked
        record.reference = {
          source: 'roblox',
          ...nearest,
          robloxThumbnailUrl: picked.url,
          thumbnail: { index: picked.index, count: picked.count, why: picked.why, pickedBy: picked.pickedBy },
          imageUrl: save('reference', picked)
        }
      } catch (err) {
        console.error(`Reference thumbnail for "${nearest.name}" failed:`, err)
      }
    }
    // No Roblox game found or its thumbnail unreachable: the remixes start from the style reference.
    record.reference ??= { source: 'style', name: style.name, imageUrl: styleRef.imageUrl }
    emit({ type: 'reference', reference: record.reference })
    return Promise.all(slots.filter((s) => ON_ROBLOX_REFERENCE.has(s.strategy)).map((slot) => generate(slot, referenceImage, record.reference.name).then(report)))
  })()
  const searchMeta = (async () => {
    // After the nearest game: it shows the model how the name reads, and Roblox refuses a burst of searches.
    const nearest = await nearestLookup
    const ranking = await rankSearch(gameName, { anchor: nearest?.name }).catch((err) => {
      console.error(`The plain Roblox search for "${gameName}" failed:`, err)
      return { ranked: [], sameCount: 0, pickedBy: null }
    })
    let referenceImage = style
    try {
      // Never the game thumbnails 2 and 4 start from: the search meta brings a second reference.
      const game = await pickSearchTop(gameName, ranking, { exclude: nearest ? [nearest.universeId] : [] })
      if (game) {
        const picked = await pickCleanestThumbnail(game, gameName)
        referenceImage = picked
        record.searchReference = {
          source: 'roblox',
          universeId: game.universeId,
          placeId: game.placeId,
          name: game.name,
          playing: game.playing,
          url: game.url,
          query: gameName,
          pickedBy: ranking.pickedBy,
          why: game.why,
          robloxThumbnailUrl: picked.url,
          thumbnail: { index: picked.index, count: picked.count, why: picked.why, pickedBy: picked.pickedBy },
          imageUrl: save('search-reference', picked)
        }
      }
    } catch (err) {
      console.error(`Search meta reference for "${gameName}" failed:`, err)
    }
    // No other game in the search, or its thumbnail unreachable: the search meta starts from the style reference.
    record.searchReference ??= { source: 'style', name: style.name, imageUrl: styleRef.imageUrl }
    emit({ type: 'searchReference', searchReference: record.searchReference })
    return Promise.all(slots.filter((s) => s.strategy === 'search').map((slot) => generate(slot, referenceImage, record.searchReference.name).then(report)))
  })()
  await Promise.all([templates, remixes, searchMeta])
  }
  record.thumbnails.sort((a, b) => a.slot - b.slot)

  const finished = record.thumbnails.filter((t) => images.has(t.slot)).map((t) => ({ slot: t.slot, ...images.get(t.slot) }))
  if (finished.length > 0) {
    emit({ type: 'judging' })
    await judgeInto(record, dir, finished, random)
    emit({ type: 'judge', judge: record.judge })
    await iconForWinner(record, dir, model, { emit })
  }
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

/** Saved runs, newest first. */
export function listRuns(outputsDir, limit = 30) {
  return readdirSync(outputsDir)
    .filter((name) => RUN_ID.test(name) && existsSync(join(outputsDir, name, 'run.json')))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((name) => JSON.parse(readFileSync(join(outputsDir, name, 'run.json'), 'utf8')))
}
