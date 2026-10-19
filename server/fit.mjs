// Before any thumbnail is drawn, one vision call rates what each strategy
// starts from (selector.mjs turns the ratings into the strategy to draw):
// whether the nearest popular game's thumbnail and the search game's thumbnail
// show the creator's game, on the judge's own fitsGame scale, and whether the
// name alone tells an artist what to draw, which is all the two templates have
// (their reference image only lends a style). The same call also reads the request's own features
// (genre, realism, abstractness, whether it is a known game) and the references' art style, so the
// selector can use them without another API call per run.
import { askJson, judgeRoutes, withoutDashes } from './llm.mjs'

export const GENRES = ['obby', 'tycoon', 'simulator', 'horror', 'survival', 'fighting', 'racing', 'shooter', 'tower_defense', 'roleplay', 'puzzle', 'other']

export const FIT_SYSTEM = `You help pick how to make a Roblox game thumbnail, before any is drawn.
You get the creator's game (its name, or their description of it) and up to two thumbnails of other Roblox games that an image model could remake into the creator's thumbnail, keeping their scene: Reference A from the nearest popular game, Reference B from the top game of a plain Roblox search.
Score from 1 to 10:
- fitA and fitB: a remake of that reference, with its scene, characters and objects kept, would show the creator's game: its gameplay, characters, objects and setting as the creator's words describe them. A different setting, activity or story scores 1 to 3 however popular the game is. A reference that clearly shows the same game idea scores 9 or 10. When the creator's words name a place or a main object and the reference lacks it, score 1 to 4.
- nameClarity: the creator's words alone tell an artist what to draw: the action, the main objects and the setting. "Run on a treadmill in a basement" scores 9 or 10; a short title such as "KAT" or a phrase that could be many games scores 1 to 4.
Also describe the creator's words alone (never the references) and each reference's art:
- genre: the one best fit of ${GENRES.join(', ')}; other when none fits.
- realism: how much the creator's game happens in the ordinary real world. 1 or 2: fantasy, magic, monsters, talking animals or impossible things. 5: a mix, such as real places with absurd twists. 9 or 10: everyday real places, jobs and objects (a bank, a pizza shop, a house, a car).
- abstractness: how hard the creator's words are to picture as one scene. 1 or 2: one concrete scene as written ("Run from a giant rubber duck in a flooded school"). 5: a clear activity with no scene. 9 or 10: a bare label, a name, or a concept with no picture ("Doors", "Banana man", "Print Money").
- knownGame: how likely the creator's words are the exact title of an existing, popular Roblox game you know of. 10: certain it is one. 1: certainly not, or a description rather than a title.
- artA and artB: the look of each reference thumbnail's art. 1 or 2: flat 2D cartoon, drawn illustration or logo art. 4 to 6: stylized 3D or the blocky Roblox look. 9 or 10: photorealistic or cinematic realistic 3D. Score a missing reference 0.
Write the reason as one plain sentence without dashes.
Reply as JSON: {"fitA": 1, "fitB": 1, "nameClarity": 1, "genre": "other", "realism": 1, "abstractness": 1, "knownGame": 1, "artA": 1, "artB": 1, "why": "..."}`

const FIT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    fitA: { type: 'INTEGER' },
    fitB: { type: 'INTEGER' },
    nameClarity: { type: 'INTEGER' },
    genre: { type: 'STRING', enum: GENRES },
    realism: { type: 'INTEGER' },
    abstractness: { type: 'INTEGER' },
    knownGame: { type: 'INTEGER' },
    artA: { type: 'INTEGER' },
    artB: { type: 'INTEGER' },
    why: { type: 'STRING' }
  },
  required: ['fitA', 'fitB', 'nameClarity', 'genre', 'realism', 'abstractness', 'knownGame', 'artA', 'artB', 'why']
}

const score = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n))) : null
}

/** The genre as one of GENRES; anything else the model wrote is `other`. */
const genreOf = (value) => {
  const genre = String(value ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_')
  return GENRES.includes(genre) ? genre : 'other'
}

/** The request features and reference art ratings a fit result carries beyond the three fit scores. */
export const FIT_FEATURES = ['genre', 'realism', 'abstractness', 'knownGame', 'nearestArt', 'searchArt']

/** True when `fit` carries every request feature, a missing reference's art rated null (ratings saved before they existed do not). */
export const hasFeatures = (fit) => FIT_FEATURES.every((key) => fit?.[key] !== undefined)

/**
 * `nearest` and `search`: { name, bytes, mimeType } of the thumbnail each strategy would start from,
 * or null when there is none. Returns { nearestFit, searchFit, nameClarity, genre, realism, abstractness,
 * knownGame, nearestArt, searchArt, why, model }; a missing reference rates null.
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
  return { ...readFit(value, { nearest: Boolean(nearest), search: Boolean(search) }), model }
}

/** The model's reply as a fit result: scores clamped to 1 to 10, a missing reference's scores null, the genre one of GENRES. */
export function readFit(value, { nearest, search }) {
  return {
    nearestFit: nearest ? score(value?.fitA) : null,
    searchFit: search ? score(value?.fitB) : null,
    nameClarity: score(value?.nameClarity),
    genre: genreOf(value?.genre),
    realism: score(value?.realism),
    abstractness: score(value?.abstractness),
    knownGame: score(value?.knownGame),
    nearestArt: nearest ? score(value?.artA) : null,
    searchArt: search ? score(value?.artB) : null,
    why: withoutDashes(value?.why)
  }
}
