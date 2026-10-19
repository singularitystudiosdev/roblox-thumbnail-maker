// One run: the game name, its two Roblox references (the nearest popular game
// and the top game of a plain Roblox search) rated against it (fit.mjs), then
// the one strategy the selector expects to win (selector.mjs) drawn twice with
// Nano Banana 2.1, then the judge, told what the game is (judgeContext), then
// the winner's icon. Now and then, or when asked, a run explores instead: all
// seven thumbnails (1 and 5: the exact and the plain template, each with the
// style reference; 2, 6 and 7: the novel perspective remix prompt, and 4: the
// meta, the plain template, each with the cleanest thumbnail of the nearest
// game; 3: the search meta, the plain template with the search game), and
// becomes an example the selector learns from. When the creator attaches an
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
import { config } from './env.mjs'
import { rateReferences } from './fit.mjs'
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
import { chooseArm, fallbackArm, loadExamples, refNamesOf, refsOf } from './selector.mjs'

const EXT = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }
const extOf = (mimeType) => EXT[mimeType] ?? 'png'

export const RUN_ID = /^[0-9TZ-]+-[0-9a-f]{8}$/

function newRunId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
}

/**
 * The slots of a run and the exact prompt each sends: the template, a remix, the search meta, the meta,
 * the plain template, then the other REMIX_COUNT - 1 remixes, after the five so their numbers stay put.
 */
export function planSlots(gameName) {
  const plain = buildPrompt(gameName, PLAIN_TEMPLATE)
  const remix = (slot) => ({ slot, strategy: 'remix', prompt: REMIX_PROMPT })
  return [
    { slot: 1, strategy: 'template', prompt: buildPrompt(gameName) },
    remix(2),
    { slot: 3, strategy: 'search', prompt: plain },
    { slot: 4, strategy: 'meta', prompt: plain },
    { slot: 5, strategy: 'plain', prompt: plain },
    ...Array.from({ length: REMIX_COUNT - 1 }, (_, i) => remix(i + 6))
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
 * A picked run: one thumbnail of each of the PICK_COUNT strategies the selector expects to lose the least, so
 * a miss on the first is covered by the second at the same cost as two of one. `arms` in that order; `first`
 * numbers the first slot (a top-up round continues after the slots drawn).
 */
export const PICK_COUNT = 2
export function planPickedSlots(gameName, arms, first = 1) {
  const promptFor = (arm) => (arm === 'template' ? buildPrompt(gameName) : arm === 'remix' ? REMIX_PROMPT : buildPrompt(gameName, PLAIN_TEMPLATE))
  return arms.map((arm, i) => ({ slot: first + i, strategy: arm, prompt: promptFor(arm) }))
}

/** The strategies a picked run draws, best first, and those a top-up round draws after them. */
export function pickedArms(selection) {
  const ranked = selection.ranked ?? [selection.arm, selection.runnerUp].filter(Boolean)
  const drawn = ranked.slice(0, PICK_COUNT)
  while (drawn.length < PICK_COUNT) drawn.push(selection.arm)
  return { drawn, topUp: ranked.slice(PICK_COUNT, PICK_COUNT * 2) }
}

/** The nearest popular game's cleanest thumbnail, saved as record.reference; null when there is none (the style reference stands in). */
async function nearestReferenceInto({ record, gameName, style, styleRef, save, emit }, nearestLookup) {
  const nearest = await nearestLookup
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

/** The top game of a plain Roblox search, never the nearest game, saved as record.searchReference; null when there is none. */
async function searchReferenceInto({ record, gameName, style, styleRef, save, emit }, nearestLookup) {
  // After the nearest game: it shows the model how the name reads, and Roblox refuses a burst of searches.
  const nearest = await nearestLookup
  const ranking = await rankSearch(gameName, { anchor: nearest?.name }).catch((err) => {
    console.error(`The plain Roblox search for "${gameName}" failed:`, err)
    return { ranked: [], sameCount: 0, pickedBy: null }
  })
  let image = null
  try {
    const game = await pickSearchTop(gameName, ranking, { exclude: nearest ? [nearest.universeId] : [] })
    if (game) {
      image = await pickCleanestThumbnail(game, gameName)
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
        robloxThumbnailUrl: image.url,
        thumbnail: { index: image.index, count: image.count, why: image.why, pickedBy: image.pickedBy },
        imageUrl: save('search-reference', image)
      }
    }
  } catch (err) {
    console.error(`Search meta reference for "${gameName}" failed:`, err)
    image = null
  }
  record.searchReference ??= { source: 'style', name: style.name, imageUrl: styleRef.imageUrl }
  emit({ type: 'searchReference', searchReference: record.searchReference })
  return image
}

/**
 * The selector's pick from the rated references (fit.mjs) and every explore run so far
 * (selector.mjs). A failed rating picks the strategy with the lowest mean regret in the explore runs
 * of the run's image model (selector.mjs fallbackArm).
 */
async function selectionFor(record, outputsDir, explore, nearestImage, searchImage) {
  let fit = null
  try {
    fit = await rateReferences(record.gameName, {
      nearest: nearestImage && { ...nearestImage, name: record.reference.name },
      search: searchImage && { ...searchImage, name: record.searchReference.name }
    })
  } catch (err) {
    console.error(`Rating the references for "${record.gameName}" failed; the pick falls back to the best strategy overall:`, err)
  }
  const examples = loadExamples(outputsDir)
  const model = record.imageModel?.key ?? null
  const choice = fit ? chooseArm({ game: record.gameName, fit, refs: refsOf(record), refNames: refNamesOf(record), model }, examples) : fallbackArm(examples, model)
  return { explore, fit, ...choice, examples: choice.learnedFrom ?? examples.length }
}

/**
 * A run from a typed name or description. Both Roblox references are looked up and rated, then
 * the selector ranks the strategies and one thumbnail of each of the top PICK_COUNT is drawn. An explore run
 * draws every strategy instead (planSlots), so the selector gains an example; its pick is still
 * recorded, the pick it would have made, which the backtest scores as a held-out guess.
 */
async function standardRun(ctx) {
  const { record, link, style, outputsDir, emit, draw, explore } = ctx
  const nearestLookup = nearestOrNull(record.gameName, link ? [link.title] : [])
  const nearestImage = nearestReferenceInto(ctx, nearestLookup)
  const searchImage = searchReferenceInto(ctx, nearestLookup)
  const picking = Promise.all([nearestImage, searchImage]).then(([n, s]) => selectionFor(record, outputsDir, explore, n, s))
  const announce = (selection) => {
    record.selection = selection
    emit({ type: 'selection', selection, slots: record.slots })
  }
  // The templates need only the style reference, so they start at once; the Roblox slots wait for their lookups.
  const drawSlot = async (slot) => {
    if (ON_STYLE_REFERENCE.has(slot.strategy)) return draw(slot, style, style.name)
    const search = slot.strategy === 'search'
    const image = await (search ? searchImage : nearestImage)
    return draw(slot, image ?? style, (search ? record.searchReference : record.reference).name)
  }
  if (explore) {
    await Promise.all([...record.slots.map(drawSlot), picking.then(announce)])
    return
  }
  const picked = await picking
  const { drawn, topUp } = pickedArms(picked)
  const selection = { ...picked, arms: drawn }
  record.slots = planPickedSlots(record.gameName, drawn)
  announce(selection)
  await Promise.all(record.slots.map(drawSlot))
  await ctx.judge()
  // Both thumbnails under the bar: both picks missed or the draws did. One each of the next two strategies,
  // then the judge sees all four.
  const best = bestTotal(record.judge)
  const bar = config().topUpBelow
  if (best == null || best >= bar || topUp.length === 0) return
  const more = planPickedSlots(record.gameName, topUp, record.slots.length + 1)
  record.slots = [...record.slots, ...more]
  announce({ ...selection, topUp: { arms: topUp, arm: topUp[0], best: Math.round(best * 10) / 10, below: bar } })
  await Promise.all(more.map(drawSlot))
  await ctx.judge()
}

/** The judge's best total for a run, or null when it scored nothing. */
function bestTotal(judge) {
  const totals = (judge?.scores ?? []).map((s) => Number(s.total)).filter(Number.isFinite)
  return totals.length > 0 ? Math.max(...totals) : null
}

/**
 * `style`: { bytes, mimeType, name, source: 'bundled' | 'upload' }, the image
 * the two templates are styled after; `attachment`: { bytes, mimeType, name }
 * attached in the prompt box, or null; `model`: the image model every slot
 * uses (imageModel(): Nano Banana 2.1); `intent` reads whether the prompt asks
 * for the attachment (swappable in tests); `exploreAll`: true draws every
 * strategy, false only the pick, null lets the explore rate decide; `withIcon`:
 * false skips the winner's icon (debug runs). Returns the saved run record.
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
  exploreAll = null,
  withIcon = true
}) {
  const started = Date.now()
  // An attached image is the reference only when the prompt asks for it; then the game is named without those words.
  const asked = attachment ? await intent(input) : null
  const attached = asked?.useAsReference ? attachment : null
  const { gameName, namedBy, link } = await resolveGameName(attached ? asked.gameText : input)
  // A link that is the game itself (not one cited in a description) makes that game the reference for every slot.
  const linked = !attached && link != null && namedBy === 'link'
  // A standard run draws every strategy when asked (exploreAll true), never when told not to (false),
  // and otherwise now and then on its own, so the selector keeps learning.
  const explore = !attached && !linked && (exploreAll ?? random() < config().selectorExploreRate)
  const id = newRunId()
  const dir = join(outputsDir, id)
  mkdirSync(dir, { recursive: true })
  const save = (name, image) => {
    const file = `${name}.${extOf(image.mimeType)}`
    writeFileSync(join(dir, file), image.bytes)
    return `/outputs/${id}/${file}`
  }

  const styleRef = { name: style.name, source: style.source, imageUrl: save('style', style) }
  // A picked run's two slots wait for the selector.
  const slots = attached ? planAttachedSlots(input, gameName) : linked ? planLinkedSlots() : explore ? planSlots(gameName) : []
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
    selection: null,
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
  // Judges every thumbnail made so far; a picked run calls it again after a top-up.
  const judgeAll = async () => {
    const finished = record.thumbnails.filter((t) => images.has(t.slot)).map((t) => ({ slot: t.slot, ...images.get(t.slot) }))
    if (finished.length === 0) return
    emit({ type: 'judging' })
    await judgeInto(record, dir, finished, random)
    emit({ type: 'judge', judge: record.judge })
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
    const draw = (slot, image, name) => generate(slot, image, name).then(report)
    await standardRun({ record, gameName, link, style, styleRef, save, emit, outputsDir, explore, draw, judge: judgeAll })
  }
  record.thumbnails.sort((a, b) => a.slot - b.slot)

  // A picked run judged as it went; every other run is judged once all its thumbnails are in.
  if (!record.judge) await judgeAll()
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
 * take as the winner, when more than one. It outranks the judge wherever the selector learns from
 * the run (selector.mjs regretsOf). Null when there is no such run or slot.
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
