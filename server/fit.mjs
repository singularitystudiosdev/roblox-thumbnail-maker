// Before any thumbnail is drawn, one vision call rates what each strategy
// starts from (selector.mjs turns the ratings into the strategy to draw):
// whether the nearest popular game's thumbnail and the search game's thumbnail
// show the creator's game, on the judge's own fitsGame scale, and whether the
// name alone tells an artist what to draw, which is all the two templates have
// (their reference image only lends a style).
import { askJson, judgeRoutes, withoutDashes } from './llm.mjs'

export const FIT_SYSTEM = `You help pick how to make a Roblox game thumbnail, before any is drawn.
You get the creator's game (its name, or their description of it) and up to two thumbnails of other Roblox games that an image model could remake into the creator's thumbnail, keeping their scene: Reference A from the nearest popular game, Reference B from the top game of a plain Roblox search.
Score from 1 to 10:
- fitA and fitB: a remake of that reference, with its scene, characters and objects kept, would show the creator's game: its gameplay, characters, objects and setting as the creator's words describe them. A different setting, activity or story scores 1 to 3 however popular the game is. A reference that clearly shows the same game idea scores 9 or 10. When the creator's words name a place or a main object and the reference lacks it, score 1 to 4.
- nameClarity: the creator's words alone tell an artist what to draw: the action, the main objects and the setting. "Run on a treadmill in a basement" scores 9 or 10; a short title such as "KAT" or a phrase that could be many games scores 1 to 4.
Write the reason as one plain sentence without dashes.
Reply as JSON: {"fitA": 1, "fitB": 1, "nameClarity": 1, "why": "..."}`

const FIT_SCHEMA = {
  type: 'OBJECT',
  properties: { fitA: { type: 'INTEGER' }, fitB: { type: 'INTEGER' }, nameClarity: { type: 'INTEGER' }, why: { type: 'STRING' } },
  required: ['fitA', 'fitB', 'nameClarity', 'why']
}

const score = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n))) : null
}

/**
 * `nearest` and `search`: { name, bytes, mimeType } of the thumbnail each strategy would start from,
 * or null when there is none. Returns { nearestFit, searchFit, nameClarity, why, model }; a missing
 * reference rates null.
 */
export async function rateReferences(gameName, { nearest = null, search = null }) {
  const images = [
    nearest && { label: 'Reference A', mimeType: nearest.mimeType, bytes: nearest.bytes },
    search && { label: 'Reference B', mimeType: search.mimeType, bytes: search.bytes }
  ].filter(Boolean)
  const lines = [
    `Creator's game: ${gameName}`,
    `Reference A: ${nearest ? `a thumbnail of "${nearest.name}"` : 'none, score fitA 1'}`,
    `Reference B: ${search ? `a thumbnail of "${search.name}"` : 'none, score fitB 1'}`
  ]
  const { value, model } = await askJson(
    { label: 'Reference fit', system: FIT_SYSTEM, user: lines.join('\n'), images, schema: FIT_SCHEMA },
    judgeRoutes()
  )
  return {
    nearestFit: nearest ? score(value?.fitA) : null,
    searchFit: search ? score(value?.fitB) : null,
    nameClarity: score(value?.nameClarity),
    why: withoutDashes(value?.why),
    model
  }
}
