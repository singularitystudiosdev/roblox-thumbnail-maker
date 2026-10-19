// One run: the game name, then three Nano Banana 2 thumbnails at once
// (1: the exact template with the style reference; 2 and 3: two random remix
// prompts with the cleanest thumbnail of the nearest popular Roblox game), then the judge.
// Each step is reported through `emit` as it lands and saved under outputs/<id>/.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveGameName } from './gamename.mjs'
import { generateThumbnail } from './imagegen.mjs'
import { judgeThumbnails } from './judge.mjs'
import { findNearestPopular } from './nearest.mjs'
import { buildPrompt, pickRemixPrompts } from './prompt.mjs'
import { pickCleanestThumbnail } from './cleanest.mjs'

const EXT = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }
const extOf = (mimeType) => EXT[mimeType] ?? 'png'

export const RUN_ID = /^[0-9TZ-]+-[0-9a-f]{8}$/

function newRunId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
}

/** The three slots of a run and the exact prompt each sends. */
export function planSlots(gameName, random = Math.random) {
  const [remixA, remixB] = pickRemixPrompts(random)
  return [
    { slot: 1, strategy: 'template', prompt: buildPrompt(gameName) },
    { slot: 2, strategy: 'remix', prompt: remixA },
    { slot: 3, strategy: 'remix', prompt: remixB }
  ]
}

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
 * thumbnail 1 is styled after. Returns the saved run record.
 */
export async function runThumbnails({ input, style, outputsDir, emit = () => {}, random = Math.random }) {
  const started = Date.now()
  const { gameName, namedBy, link } = await resolveGameName(input)
  const id = newRunId()
  const dir = join(outputsDir, id)
  mkdirSync(dir, { recursive: true })
  const save = (name, image) => {
    const file = `${name}.${extOf(image.mimeType)}`
    writeFileSync(join(dir, file), image.bytes)
    return `/outputs/${id}/${file}`
  }

  const styleRef = { name: style.name, source: style.source, imageUrl: save('style', style) }
  const slots = planSlots(gameName, random)
  const record = { id, createdAt: new Date().toISOString(), input, gameName, namedBy, link, style: styleRef, reference: null, slots, thumbnails: [], judge: null }
  emit({ type: 'plan', run: record })

  const images = new Map()
  const generate = async (slot, referenceImage, referenceName) => {
    const t0 = Date.now()
    const base = { slot: slot.slot, strategy: slot.strategy, prompt: slot.prompt, referenceName }
    try {
      const image = await generateThumbnail(slot.prompt, referenceImage)
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

  const template = generate(slots[0], style, style.name).then(report)
  const remixes = (async () => {
    const nearest = await nearestOrNull(gameName, link ? [link.title] : [])
    let referenceImage = style
    if (nearest) {
      try {
        const picked = await pickCleanestThumbnail(nearest)
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
    return Promise.all(slots.slice(1).map((slot) => generate(slot, referenceImage, record.reference.name).then(report)))
  })()
  await Promise.all([template, remixes])
  record.thumbnails.sort((a, b) => a.slot - b.slot)

  const finished = record.thumbnails.filter((t) => images.has(t.slot)).map((t) => ({ slot: t.slot, ...images.get(t.slot) }))
  if (finished.length > 0) {
    emit({ type: 'judging' })
    try {
      record.judge = await judgeThumbnails(gameName, finished, { random })
    } catch (err) {
      console.error('Judging failed:', err)
      record.judge = { error: err.message, winnerSlot: null }
    }
    emit({ type: 'judge', judge: record.judge })
  }
  record.winnerSlot = record.judge?.winnerSlot ?? null
  record.ms = Date.now() - started
  writeFileSync(join(dir, 'run.json'), JSON.stringify(record, null, 2))
  emit({ type: 'done', run: record })
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
