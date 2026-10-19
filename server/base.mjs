// Before any thumbnail is drawn, a panel of three vision calls rates each Roblox reference as a starting point:
// how much better a thumbnail made from it would be than a new scene in the style image's look, 1 to 10, 5 as good.
// The rubrics read that question three ways: polish (a polished Roblox 3D render of the creator's idea), genre (a mood
// that suits the game, a title logo allowed, the creator's own game kept), and strategy (what each strategy's prompt
// does with a reference: remix keeps its scene and never hears the name, meta and search take only its look). Their
// mean is the rating selector.mjs draws from (chooseByPanel): a reference above the bar is drawn, else the style image.
// No one rubric matched the creator's picks; their mean did (debug/strategy-backtest.mjs, "panel").
import { askJson, judgeRoutes } from './llm.mjs'

const POLISH = `You help decide what a Roblox game thumbnail should start from, before any is drawn.
An image model will make the creator's thumbnail in one of three ways: remake Reference A keeping its scene, remake Reference B keeping its scene, or draw a new scene of the creator's game from their words alone in the polished style of image S.
Score baseA and baseB from 1 to 10: how much better a remake of that reference would be than the new scene in S's style, as a thumbnail a scrolling Roblox player grasps at a glance and wants to click.
8 to 10: the reference already is a strong modern Roblox thumbnail of the creator's game idea: a polished, bright 3D render in the Roblox look, one bold subject, the creator's activity, objects and setting, little or no text.
1 to 3: a remake would carry over a problem: a different game idea or setting, a dated or low effort image, dark or murky, cluttered, mostly text, logos or interface, a flat 2D drawing, or realistic scenery with no Roblox characters.
5: the remake and the new scene would be about as good. Score a missing reference 1.
Write the reason as one plain sentence without dashes.
Reply as JSON: {"baseA": 1, "baseB": 1, "why": "..."}`

const GENRE = `You help decide what a Roblox game thumbnail should start from, before any is drawn.
An image model will make the creator's thumbnail in one of three ways: remake Reference A keeping its scene, remake Reference B keeping its scene, or draw a new scene of the creator's game from their words alone in the polished style of image S.
Score baseA and baseB from 1 to 10: how much better a remake of that reference would be than the new scene in S's style, as a thumbnail a scrolling Roblox player grasps at a glance and wants to click.
8 to 10: a polished, professional thumbnail that shows the creator's game idea: its activity, characters, objects or setting, with one clear focal subject. A mood that suits the genre is right (dark suits horror or tactical games), and a title logo is fine while the scene carries the image.
When a reference is the creator's own game (the same title), a remake keeps the look its players already recognise: score it 7 or more unless it is mostly text.
1 to 3: a remake would carry over a problem: a different game idea, activity or setting, a dated or low effort image, mostly text or interface, a flat 2D drawing, or an empty scene with no characters or action.
5: the remake and the new scene would be about as good. Score a missing reference 1.
Write the reason as one plain sentence without dashes.
Reply as JSON: {"baseA": 1, "baseB": 1, "why": "..."}`

const STRATEGY = `You help decide how to make a Roblox game thumbnail, before any is drawn. An image model can make it four ways:
1. Remake Reference A: it keeps A's scene, characters and objects and only moves the camera. It never hears the creator's words.
2. Draw a new scene of the creator's game from their words, in the style of Reference A.
3. The same, in the style of Reference B.
4. The same, in the style of image S, a polished all-round Roblox look.
Score from 1 to 10 how much better each of the first three would be than way 4, as a thumbnail a scrolling Roblox player grasps at a glance and wants to click. 5 means about as good.
- remixA: high only when A's scene already shows the creator's game idea (its activity, characters, objects or setting) as a polished thumbnail with one clear subject. A different idea, activity or setting scores 1 to 3 however good A looks, because the remake keeps A's content.
- styleA and styleB: that reference's look (render quality, colour, lighting, character style, mood) as the look of the creator's game. High when it is a polished, professional Roblox look whose mood suits this game (dark suits horror or tactical games); its subject matters only as far as the look carries the game's world. Low when the look is dated or low effort, mostly text or interface, a flat 2D drawing, or a photo-like scene that is not the Roblox look.
When a reference is the creator's own game (the same title), its scene and look are the ones its players recognise: score it 7 or more on every way it serves, unless it is mostly text.
Score a missing reference 1 on every way.
Write the reason as one plain sentence without dashes.
Reply as JSON: {"remixA": 1, "styleA": 1, "styleB": 1, "why": "..."}`

const integers = (...keys) => ({ type: 'OBJECT', properties: Object.fromEntries([...keys, 'why'].map((k) => [k, { type: k === 'why' ? 'STRING' : 'INTEGER' }])), required: [...keys, 'why'] })

const score = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n))) : null
}

/** The three rubrics: each one's prompt, the line that introduces image S, its reply schema and how its reply reads as { a, b }. */
export const BASE_RUBRICS = [
  { name: 'polish', system: POLISH, styleLine: 'Style image S: lends only its look to a new scene.', schema: integers('baseA', 'baseB'), read: (v) => ({ a: score(v?.baseA), b: score(v?.baseB) }) },
  { name: 'genre', system: GENRE, styleLine: 'Style image S: lends only its look to a new scene.', schema: integers('baseA', 'baseB'), read: (v) => ({ a: score(v?.baseA), b: score(v?.baseB) }) },
  {
    name: 'strategy',
    system: STRATEGY,
    styleLine: 'Image S: the default look for a new scene.',
    schema: integers('remixA', 'styleA', 'styleB'),
    // Reference A serves two strategies (remix keeps its scene, meta takes its look): it rates as the better of them.
    read: (v) => {
      const remix = score(v?.remixA)
      const style = score(v?.styleA)
      return { a: remix == null && style == null ? null : Math.max(remix ?? 1, style ?? 1), b: score(v?.styleB) }
    }
  }
]

const mean = (values) => (values.length === 0 ? null : Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10)

/**
 * The panel's ratings, as the selector reads them: the mean of each reference's scores (null for a reference the run
 * did not find), and each rubric's own scores and reason.
 */
export function readBase(panel, { nearest, search }) {
  return {
    nearestBase: nearest ? mean(panel.map((p) => p.a).filter((v) => v != null)) : null,
    searchBase: search ? mean(panel.map((p) => p.b).filter((v) => v != null)) : null,
    panel
  }
}

/**
 * `nearest`, `search` and `style`: { name, bytes, mimeType } of the nearest popular game's thumbnail, the search
 * game's and the style image; a missing reference is null. The three rubrics run at once; one that fails is left out
 * of the mean, and the call throws only when all three fail. Returns readBase's { nearestBase, searchBase, panel }.
 */
export async function rateBases(gameName, { nearest = null, search = null, style }, { ask = askJson } = {}) {
  const images = [
    nearest && { label: 'Reference A', mimeType: nearest.mimeType, bytes: nearest.bytes },
    search && { label: 'Reference B', mimeType: search.mimeType, bytes: search.bytes },
    style && { label: 'Style image S', mimeType: style.mimeType, bytes: style.bytes }
  ].filter(Boolean)
  const head = [`Creator's game: ${gameName}`, `Reference A: ${nearest ? `a thumbnail of "${nearest.name}"` : 'none'}`, `Reference B: ${search ? `a thumbnail of "${search.name}"` : 'none'}`]
  const settled = await Promise.allSettled(
    BASE_RUBRICS.map((rubric) => ask({ label: `Reference base (${rubric.name})`, system: rubric.system, user: [...head, rubric.styleLine].join('\n'), images, schema: rubric.schema }, judgeRoutes()))
  )
  const panel = []
  settled.forEach((result, i) => {
    const rubric = BASE_RUBRICS[i]
    if (result.status === 'rejected') return console.error(`Reference base rubric ${rubric.name} for "${gameName}" failed:`, result.reason)
    panel.push({ rubric: rubric.name, ...rubric.read(result.value.value), why: String(result.value.value?.why ?? ''), model: result.value.model })
  })
  if (panel.length === 0) throw new Error(`Every reference base rubric failed for "${gameName}"`)
  return readBase(panel, { nearest: Boolean(nearest), search: Boolean(search) })
}
