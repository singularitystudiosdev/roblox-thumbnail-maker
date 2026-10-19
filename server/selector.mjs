// Picks the one strategy a run draws twice, instead of drawing all seven
// thumbnails and judging them all. Every past run that drew every strategy
// (an "explore" run) is an example: how far each strategy fell short of that
// run's winner, in judge points out of 50 (its regret).
//
// What a strategy is judged on is what it starts from: meta and search send
// the same plain template, so "the plain template on game X's thumbnail" is
// one situation whichever lookup found X (Roblox lookups drift: a run of "Fake
// an Egg" found the game itself as the nearest game, a later one as the top
// search game). A strategy's expected regret is its past regrets in like
// situations: the same game name, the same reference game, a like rating of
// that reference (fit.mjs), weighted by likeness and shrunk toward a line of
// regret on that rating fitted over every example. The lowest expected regret
// wins. Each explore run adds an example, so the pick keeps learning;
// debug/strategy-backtest.mjs measures it leave-one-out.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const ARMS = ['template', 'remix', 'search', 'meta', 'plain']

// Strategies that send the same prompt on the same kind of reference share their evidence.
const FAMILY = { template: 'template', plain: 'plain', remix: 'remix', meta: 'onGame', search: 'onGame' }

// Kernel, prior and same-reference boost, chosen by the leave-one-out backtest (debug/strategy-backtest.mjs).
// pool: meta and search share evidence; slope: the prior leans on the rating; allFits: likeness compares all
// three ratings, not only the one the strategy starts from.
// typed: the prior is the strategy's regret in runs of the same prompt type (typeShrink examples' worth
// of pull toward the coarser type).
// otherModel: how much an example drawn with a different image model counts (strategies rank
// differently per model: plain led under Nano Banana 2.1, meta under Pro).
export const DEFAULT_PARAMS = { nameWeight: 1, fitWeight: 1, bandwidth: 0.35, prior: 1, refBoost: 4, pool: 'sameRef', slope: false, allFits: true, typed: true, typeShrink: 2, otherModel: 0.25 }

const STOP = new Set(['a', 'an', 'the', 'my', 'of', 'in', 'on', 'with', 'and', 'for', 'to', 'game', 'roblox', 'your', 'me', 'make', 'thumbnail', 'but'])

/** The words of a game name that say what it is: lowercase, no tags, emoji, plurals or filler. */
export function nameTokens(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/s$/, ''))
    .filter((t) => !STOP.has(t))
}

function jaccard(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  if (A.size === 0 && B.size === 0) return 1
  let shared = 0
  for (const t of A) if (B.has(t)) shared++
  return shared / (A.size + B.size - shared)
}

/** The Roblox games a run's strategies start from, by universe id; null where a lookup found none. */
export function refsOf(run) {
  const id = (ref) => (ref?.source === 'roblox' && ref.universeId != null ? String(ref.universeId) : null)
  return { nearest: id(run?.reference), search: id(run?.searchReference) }
}

/** The names of those games, for how closely each matches the prompt's name. */
export function refNamesOf(run) {
  const name = (ref) => (ref?.source === 'roblox' ? (ref.name ?? null) : null)
  return { nearest: name(run?.reference), search: name(run?.searchReference) }
}

/** How closely a game's name matches the prompt: exact (the same words), near (some shared) or none. */
export const matchLevel = (gameName, refName) => {
  if (!refName) return 'none'
  const j = jaccard(nameTokens(gameName), nameTokens(refName))
  return j >= 0.75 ? 'exact' : j >= 0.2 ? 'near' : 'none'
}

/**
 * A prompt's type, which strategies tend to win for: whether a reference game has its very name
 * (exact), shares words with it (near) or neither, and whether it is a description (3 or more
 * words that say what it is) or a short name.
 */
export function promptType(item) {
  const levels = ['nearest', 'search'].map((w) => matchLevel(item.game, item.refNames?.[w]))
  const match = levels.includes('exact') ? 'exact' : levels.includes('near') ? 'near' : 'none'
  return { match, descriptive: nameTokens(item.game).length >= 3 }
}

/** What `arm` starts from in a run `item` ({ fit, refs }): the reference game (or 'style') and its rating. */
function situation(item, arm) {
  const type = promptType(item)
  if (arm === 'meta' || arm === 'remix') return { ref: item.refs?.nearest ?? null, fit: item.fit?.nearestFit ?? 1, level: matchLevel(item.game, item.refNames?.nearest), type }
  if (arm === 'search') return { ref: item.refs?.search ?? null, fit: item.fit?.searchFit ?? 1, level: matchLevel(item.game, item.refNames?.search), type }
  return { ref: 'style', fit: item.fit?.nameClarity ?? 1, level: 'style', type }
}

// A thumbnail the creator passed over for their own pick counts at least this far behind it.
export const LABEL_MARGIN = 2

/**
 * How far each strategy fell short of the run's best thumbnail, from a judged run that drew every
 * strategy; null for any other run. A strategy drawn more than once counts its mean, as one draw.
 * The creator's own pick (run.userPick, or every slot in its `accept`) outranks the judge: each
 * strategy they accept is a winner, and every other strategy falls at least LABEL_MARGIN behind them.
 */
export function regretsOf(run) {
  const scores = run?.judge?.scores
  if (!scores?.length) return null
  const byArm = Object.fromEntries(ARMS.map((a) => [a, []]))
  for (const s of scores) {
    const strategy = run.slots.find((slot) => slot.slot === s.slot)?.strategy
    if (byArm[strategy]) byArm[strategy].push(Number(s.total))
  }
  if (ARMS.some((a) => byArm[a].length === 0)) return null
  const mean = (a) => byArm[a].reduce((sum, v) => sum + v, 0) / byArm[a].length
  const accepted = run.userPick ? (run.userPick.accept ?? [run.userPick.slot]) : []
  const picked = scores.filter((s) => accepted.includes(s.slot))
  const pickedArms = new Set(picked.map((s) => run.slots.find((slot) => slot.slot === s.slot)?.strategy).filter((a) => byArm[a]))
  if (pickedArms.size > 0) {
    const top = Math.max(...picked.map((s) => Number(s.total)))
    return Object.fromEntries(ARMS.map((a) => [a, pickedArms.has(a) ? 0 : Math.max(top - mean(a), LABEL_MARGIN)]))
  }
  const best = Math.max(...scores.map((s) => Number(s.total)))
  return Object.fromEntries(ARMS.map((a) => [a, best - mean(a)]))
}

/** The image model a run drew with: its record, or for runs that kept none, the endpoint its images name. */
export function modelOf(run) {
  if (run?.imageModel?.key) return run.imageModel.key
  const version = String(run?.thumbnails?.find((t) => t.model)?.model ?? '').match(/nano-banana-(2\.1|2|pro)\b/)?.[1]
  return version ? `nano-banana-${version}` : null
}

/** An example from a saved run: an explore run that recorded its reference ratings. */
export function exampleOf(run) {
  const regret = (run?.mode ?? 'standard') === 'standard' && run.selection?.fit ? regretsOf(run) : null
  if (!regret) return null
  return { id: run.id, game: run.gameName, fit: run.selection.fit, refs: refsOf(run), refNames: refNamesOf(run), model: modelOf(run), regret }
}

/**
 * The selector's examples: every explore run in outputsDir, read fresh, so a re-judge or the
 * creator's own pick changes what it learns at once; plus the shipped ones (selector-seed.json) for
 * runs this machine does not have. A shipped example whose run is here keeps its reference ratings
 * (runs from before the selector rated none) and takes everything else from the run.
 */
export function loadExamples(outputsDir, seedFile = new URL('./selector-seed.json', import.meta.url)) {
  const seed = seedFile && existsSync(seedFile) ? JSON.parse(readFileSync(seedFile, 'utf8')).examples : []
  const byId = new Map(seed.map((e) => [e.id, e]))
  if (outputsDir && existsSync(outputsDir)) {
    for (const name of readdirSync(outputsDir)) {
      const file = join(outputsDir, name, 'run.json')
      if (!existsSync(file)) continue
      try {
        const run = JSON.parse(readFileSync(file, 'utf8'))
        const shipped = byId.get(name)
        const example = exampleOf(shipped && !run.selection?.fit ? { ...run, selection: { ...run.selection, fit: shipped.fit } } : run)
        if (example) byId.set(name, { ...example, id: name, model: example.model ?? shipped?.model ?? null })
      } catch (err) {
        console.error(`Saved run ${name} could not be read as a selector example:`, err)
      }
    }
  }
  return [...byId.values()]
}

/** Every past outcome that counts as evidence for `arm`: its family's regrets with the situation each started from. */
// pool 'sameRef': a family member's outcome counts only when it started from the very game `ref` does.
function evidenceFor(arm, examples, params = DEFAULT_PARAMS, ref = null) {
  const family = params.pool ? ARMS.filter((a) => FAMILY[a] === FAMILY[arm]) : [arm]
  return examples.flatMap((e) =>
    family
      .map((a) => ({ example: e, arm: a, value: e.regret[a], tokens: nameTokens(e.game), fits: fitsOf(e), model: e.model ?? null, ...situation(e, a) }))
      .filter((p) => p.arm === arm || params.pool !== 'sameRef' || (ref != null && p.ref === ref))
  )
}

/** Least squares line of regret on rating, its slope shrunk toward flat: the prior for a strategy at a rating. */
function priorLine(points, ridge = 20) {
  const n = points.length
  if (n === 0) return () => 0
  const mx = points.reduce((s, p) => s + p.fit, 0) / n
  const my = points.reduce((s, p) => s + p.value, 0) / n
  const sxy = points.reduce((s, p) => s + (p.fit - mx) * (p.value - my), 0)
  const sxx = points.reduce((s, p) => s + (p.fit - mx) ** 2, 0)
  const slope = sxy / (sxx + ridge)
  return (fit) => my + slope * (fit - mx)
}

const fitsOf = (item) => [item.fit?.nearestFit ?? 1, item.fit?.searchFit ?? 1, item.fit?.nameClarity ?? 1]

// What a strategy is, for the typed prior: meta and search both send the plain template on a game.
const ROLE = { template: 'template', plain: 'plain', remix: 'remix', meta: 'onGame', search: 'onGame' }

/**
 * A strategy's regret in runs of the same type: the same role on a reference matching the prompt as
 * closely, in a prompt of the same match and length, each level shrunk toward the coarser one.
 */
function typedPrior(arm, here, examples, flat, params) {
  const points = examples.flatMap((e) => ARMS.filter((a) => ROLE[a] === ROLE[arm]).map((a) => ({ value: e.regret[a], w: modelWeight(here, e.model ?? null, params), ...situation(e, a) })))
  const keys = [
    (p) => p.level,
    (p) => `${p.level}|${p.type.match}`,
    (p) => `${p.level}|${p.type.match}|${p.type.descriptive}`
  ]
  let estimate = flat
  for (const key of keys) {
    const same = points.filter((p) => key(p) === key(here))
    const weight = same.reduce((sum, p) => sum + p.w, 0)
    estimate = (same.reduce((sum, p) => sum + p.w * p.value, 0) + params.typeShrink * estimate) / (weight + params.typeShrink)
  }
  return estimate
}

/** An example drawn with the run's own image model counts fully; one from another model counts `otherModel`. */
const modelWeight = (current, model, params) => (current.model == null || model == null || model === current.model ? 1 : (params.otherModel ?? 1))

function likeness(current, point, params) {
  const nameDistance = 1 - jaccard(current.tokens, point.tokens)
  const fitDistance = params.allFits
    ? Math.hypot(...current.fits.map((v, i) => (v - point.fits[i]) / 9)) / Math.sqrt(3)
    : (current.fit - point.fit) / 9
  const d2 = params.nameWeight * nameDistance ** 2 + params.fitWeight * fitDistance ** 2
  const sameRef = current.ref != null && current.ref !== 'style' && current.ref === point.ref
  return Math.exp(-d2 / (2 * params.bandwidth ** 2)) * (sameRef ? params.refBoost : 1) * modelWeight(current, point.model, params)
}

/** Expected regret per strategy for a run `current` ({ game, fit, refs }) from `examples`. */
export function expectedRegrets(current, examples, params = DEFAULT_PARAMS) {
  const tokens = nameTokens(current.game)
  return Object.fromEntries(
    ARMS.map((arm) => {
      const here = { tokens, fits: fitsOf(current), model: current.model ?? null, ...situation(current, arm) }
      const points = evidenceFor(arm, examples, params, here.ref)
      if (points.length === 0) return [arm, null]
      const weights = points.map((p) => likeness(here, p, params))
      const total = weights.reduce((sum, w) => sum + w, 0)
      const weighted = points.reduce((sum, p, i) => sum + weights[i] * p.value, 0)
      const own = points.filter((p) => p.arm === arm)
      const ownWeight = own.reduce((sum, p) => sum + modelWeight(here, p.model, params), 0)
      const flat = own.reduce((sum, p) => sum + modelWeight(here, p.model, params) * p.value, 0) / ownWeight
      const prior = params.slope ? priorLine(points)(here.fit) : params.typed ? typedPrior(arm, here, examples, flat, params) : flat
      return [arm, (weighted + params.prior * prior) / (total + params.prior)]
    })
  )
}

/** The past runs most like `current` for `arm`, closest first, for the reason shown with the pick. */
export function closestExamples(current, arm, examples, count = 3, params = DEFAULT_PARAMS) {
  const here = { tokens: nameTokens(current.game), fits: fitsOf(current), model: current.model ?? null, ...situation(current, arm) }
  const best = new Map()
  for (const p of evidenceFor(arm, examples, params, here.ref)) {
    const w = likeness(here, p, params)
    if (!best.has(p.example.id) || best.get(p.example.id).weight < w) best.set(p.example.id, { example: p.example, weight: w })
  }
  return [...best.values()].sort((a, b) => b.weight - a.weight).slice(0, count)
}

const lowest = (expected) => ARMS.reduce((best, a) => (expected[a] < expected[best] ? a : best), 'meta')

/**
 * The strategy to draw for a run `current` ({ game, fit, refs }): the lowest expected regret, and the
 * runner-up a top-up round draws. With no examples, meta, the best single strategy in the backtest.
 * Returns { arm, runnerUp, expected, closest: [{ id, game, winner, weight }] }.
 */
export function chooseArm(current, examples, params = DEFAULT_PARAMS) {
  if (examples.length === 0) return { arm: 'meta', runnerUp: 'template', type: typeOf(current), expected: null, closest: [] }
  const expected = expectedRegrets(current, examples, params)
  const arm = lowest(expected)
  const runnerUp = lowest({ ...expected, [arm]: Infinity })
  const closest = closestExamples(current, arm, examples, 3, params).map(({ example, weight }) => ({
    id: example.id,
    game: example.game,
    winner: lowest(example.regret),
    weight: Math.round(weight * 100) / 100
  }))
  return { arm, runnerUp, type: typeOf(current), expected: Object.fromEntries(ARMS.map((a) => [a, Math.round(expected[a] * 10) / 10])), closest }
}

/** The prompt's type as the pick read it, with the Roblox game that has its exact name, if one does. */
function typeOf(current) {
  const named = ['nearest', 'search'].map((w) => current.refNames?.[w]).find((name) => name && matchLevel(current.game, name) === 'exact')
  return { ...promptType(current), game: named ?? null }
}
