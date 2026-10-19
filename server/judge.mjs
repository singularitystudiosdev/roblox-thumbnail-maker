// The judge: a vision model sees the finished thumbnails with the game name,
// scores each on the four things a winner needs (coherent, makes sense for the
// name, clean, clickable) and picks one. The thumbnails keep their own numbers
// but are shown in shuffled order, so position cannot favour one strategy and
// whatever number the model writes in its reason is the one the page shows.
import { askJson, judgeRoutes, withoutDashes } from './llm.mjs'

export const CRITERIA = ['coherent', 'fitsName', 'clean', 'clickable']

const JUDGE_SYSTEM = `You judge Roblox game thumbnails for a creator. You get their game (its name, or their description of it) and numbered candidate thumbnails, in no particular order.
Score every candidate from 1 to 10 on:
- coherent: the scene, characters and objects make visual and physical sense (no warped bodies, merged limbs, broken perspective or smeared areas).
- fitsName: it makes sense for this game; a player reading the game name would expect this picture.
- clean: uncluttered, free of artifacts, watermarks and stray or garbled text (the thumbnails were asked for no text).
- clickable: at small size on the Roblox home page it reads at a glance, with a clear subject, strong contrast and a reason to click.
Then pick the winner: the best thumbnail for this game on all four together, not just the prettiest image.
Write each note and the reason as one or two plain sentences without dashes. Refer to a candidate as "Thumbnail" and its number.
Reply as JSON: {"scores":[{"thumbnail":1,"coherent":1,"fitsName":1,"clean":1,"clickable":1,"note":"..."}],"winner":1,"reason":"..."}`

const SCORE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    thumbnail: { type: 'INTEGER' },
    ...Object.fromEntries(CRITERIA.map((c) => [c, { type: 'INTEGER' }])),
    note: { type: 'STRING' }
  },
  required: ['thumbnail', ...CRITERIA, 'note']
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
// "3", 3 or "Thumbnail 3" all name slot 3.
const slotNumber = (value) => Number(String(value ?? '').match(/\d+/)?.[0])

/** The model's verdict over the shown slots; a winner it did not name validly is the top total. */
export function readVerdict(value, slots) {
  const shown = new Set(slots)
  const scores = []
  for (const row of Array.isArray(value?.scores) ? value.scores : []) {
    const slot = slotNumber(row?.thumbnail)
    if (!shown.has(slot) || scores.some((s) => s.slot === slot)) continue
    const marks = Object.fromEntries(CRITERIA.map((c) => [c, clampScore(row[c])]))
    scores.push({ slot, ...marks, total: CRITERIA.reduce((sum, c) => sum + marks[c], 0), note: withoutDashes(row.note) })
  }
  scores.sort((a, b) => a.slot - b.slot)
  const named = shown.has(slotNumber(value?.winner)) ? slotNumber(value.winner) : null
  const top = scores.reduce((best, s) => (best && best.total >= s.total ? best : s), null)
  const winnerSlot = named ?? top?.slot ?? null
  if (!winnerSlot) throw new Error('The judge named no winner and scored no thumbnail.')
  return { winnerSlot, reason: withoutDashes(value?.reason), scores, winnerFrom: named ? 'judge' : 'top score' }
}

/**
 * `entries`: [{ slot, bytes, mimeType }] for the thumbnails that generated.
 * Returns { winnerSlot, reason, scores, order, provider, model }.
 */
export async function judgeThumbnails(gameName, entries, { random = Math.random } = {}) {
  if (entries.length === 1) {
    return { winnerSlot: entries[0].slot, reason: 'The only thumbnail that generated.', scores: [], order: [entries[0].slot], provider: null, model: null }
  }
  const order = shuffled(entries, random)
  const labels = order.map((entry) => `Thumbnail ${entry.slot}`)
  const { value, provider, model } = await askJson(
    {
      label: 'Thumbnail judge',
      system: JUDGE_SYSTEM,
      user: `Game: ${gameName}\n\nCandidates: ${labels.join(', ')}. Each image follows its label.`,
      images: order.map((entry, i) => ({ label: labels[i], mimeType: entry.mimeType, bytes: entry.bytes })),
      schema: JUDGE_SCHEMA
    },
    judgeRoutes()
  )
  const slots = order.map((entry) => entry.slot)
  return { ...readVerdict(value, slots), order: slots, provider, model }
}
