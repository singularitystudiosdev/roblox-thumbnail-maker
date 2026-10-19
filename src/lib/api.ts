/** The image thumbnail 1 is made "in the style of": the bundled one or the user's upload. */
export interface StyleRef {
  name: string
  source: 'bundled' | 'upload'
  imageUrl: string
}

/** The popular Roblox game like the creator's, whose thumbnail the remixes (thumbnails 2 to 4) start from. */
export interface Reference {
  source: 'roblox' | 'style'
  name: string
  imageUrl: string
  universeId?: number
  placeId?: number
  playing?: number
  url?: string
  queries?: string[]
  candidateCount?: number
  pickedBy?: string
  why?: string
  /** Which of the game page's thumbnails was picked as the cleanest, and why. */
  thumbnail?: { index: number; count: number; why: string; pickedBy: string | null }
  /** The search meta's game only: the name searched for. */
  query?: string
  /** The creator's own linked game, the reference for every slot. */
  linked?: boolean
}

export interface Slot {
  slot: number
  /**
   * template: the exact template; plain: the plain template (both with the style reference);
   * remix: the novel perspective remix; meta: the plain template (both with the Roblox reference);
   * search: the plain template with the top game of a plain Roblox search (searchReference);
   * typed: the creator's prompt as typed; plain-attached: the plain template (both with the attached image).
   */
  strategy: 'template' | 'plain' | 'remix' | 'meta' | 'search' | 'typed' | 'plain-attached'
  prompt: string
}

export interface Thumbnail extends Slot {
  referenceName: string
  imageUrl?: string
  /** The 512 by 512 Roblox icon made from it; runs saved before icons have none. */
  iconUrl?: string
  /** True when the image model redrew it square; false when the thumbnail was fitted whole. */
  iconRedrawn?: boolean
  provider?: 'gemini' | 'fal'
  model?: string
  ms: number
  error?: string
}

/** A strategy a typed-name run can draw: everything but the attached-image ones. */
export type Arm = 'template' | 'remix' | 'search' | 'meta' | 'plain'

/** The selector's pick for a typed-name run, from the rated references and past explore runs. */
export interface Selection {
  /** True: the run drew every strategy to teach the selector; `arm` is the pick it would have made. */
  explore: boolean
  /** The references rated 1 to 10 against the game; null when the rating failed and the pick fell back to meta. */
  fit: { nearestFit: number | null; searchFit: number | null; nameClarity: number | null; why: string } | null
  arm: Arm
  /** How the pick read the prompt: a Roblox game has its exact name (`game`), shares words with it, or neither; a description or a short name. */
  type?: { match: 'exact' | 'near' | 'none'; descriptive: boolean; game: string | null }
  /** The next best strategy, which a top-up round draws. */
  runnerUp?: Arm
  /** Both picked thumbnails scored under `below` (of 50), best `best`: two more were drawn with `arm`. */
  topUp?: { arm: Arm; best: number; below: number } | null
  /** Judge points out of 50 each strategy is expected to fall short of drawing all seven. */
  expected: Record<Arm, number> | null
  /** The past explore runs most like this prompt and the strategy that won each. */
  closest: { id: string; game: string; winner: Arm; weight: number }[]
  /** How many explore runs the pick learned from. */
  examples: number
}

/** Per-criterion marks out of 10 (fitsGame, robloxStyle, clean, clickable, coherent; older runs had fitsName), their total and a note. */
export interface Score {
  slot: number
  total: number
  note: string
  [criterion: string]: number | string
}

export interface Judge {
  winnerSlot: number | null
  reason?: string
  scores?: Score[]
  /** Out of what the totals are; runs before the five-criterion rubric were out of 40. */
  maxTotal?: number
  /** Below this mean fitsGame a thumbnail is ruled out whatever its total. */
  minFitsGame?: number
  votes?: Record<string, number>
  /** Each judge pass: the slot it picked and the order it saw. */
  passes?: { winnerSlot: number; order: number[]; totals: Record<string, number> }[]
  context?: { own: boolean; name: string; withImage: boolean } | null
  provider?: string | null
  model?: string | null
  error?: string
}

export interface Run {
  id: string
  createdAt: string
  input: string
  gameName: string
  namedBy: 'link' | 'typed'
  link: { placeId: string; title: string; url: string } | null
  style: StyleRef
  /**
   * standard: two thumbnails of the selector's pick, or all seven on an explore run; attached: two from the image attached in the prompt box;
   * linked: five novel perspective remixes of the linked game's own thumbnail. Older runs have none.
   */
  mode?: 'standard' | 'attached' | 'linked'
  /** The image attached in the prompt box; used: the prompt asked to use it as the reference. */
  attachment?: { name: string; imageUrl: string; used: boolean; readBy: string | null } | null
  /** The image model every slot used; runs saved before it was recorded have none and used Nano Banana 2. */
  imageModel?: { key: string; label: string }
  reference: Reference | null
  /** The search meta's game; runs saved before it have none. */
  searchReference?: Reference | null
  /** Typed-name runs since the selector: the strategy it picked; older runs drew every strategy and have none. */
  selection?: Selection | null
  /** A picked run's slots arrive with its selection; until then there are none. */
  slots: Slot[]
  thumbnails: Thumbnail[]
  judge: Judge | null
  winnerSlot?: number | null
  /** The creator's own winner, when they disagree with the judge; the strategy picker learns from it. */
  userPick?: { slot: number; accept?: number[]; at: string } | null
  ms?: number
}

export type RunEvent =
  | { type: 'plan'; run: Run }
  | { type: 'reference'; reference: Reference }
  | { type: 'searchReference'; searchReference: Reference }
  | { type: 'selection'; selection: Selection; slots: Slot[] }
  | { type: 'thumbnail'; thumbnail: Thumbnail }
  | { type: 'icon'; slot: number; iconUrl: string; iconRedrawn: boolean }
  | { type: 'judging' }
  | { type: 'judge'; judge: Judge }
  | { type: 'done'; run: Run }
  | { type: 'error'; error: string }

export interface Status {
  geminiKeys: number
  falKeys: number
  imageProvider: string
  imageModel: string
  falModel: string
  /** "Nano Banana 2.1": the one image model. */
  imageModelLabel: string
  styleReferenceName: string
}

export interface StyleUpload {
  dataUrl: string
  name: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const body = await res.json().catch((err) => {
    console.error(`${path} returned a non-JSON body`, err)
    return null
  })
  if (!res.ok) throw new Error(body?.error ?? `Request failed with HTTP ${res.status}. Check the server terminal.`)
  return body as T
}

/** Starts a run and hands each NDJSON event to `onEvent` as it arrives; `explore` draws every strategy. */
async function run(prompt: string, style: StyleUpload | null, attachment: StyleUpload | null, onEvent: (event: RunEvent) => void, explore = false) {
  const res = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, style, attachment, explore })
  })
  if (!res.ok || !res.body) {
    const body = await res.json().catch((err) => {
      console.error('/api/run returned a non-JSON error body', err)
      return null
    })
    throw new Error(body?.error ?? `Request failed with HTTP ${res.status}. Check the server terminal.`)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) onEvent(JSON.parse(line) as RunEvent)
      newline = buffer.indexOf('\n')
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as RunEvent)
}

export const api = {
  run,
  runs: () => request<{ items: Run[] }>('/api/runs'),
  rejudge: (id: string) => request<Run>(`/api/runs/${encodeURIComponent(id)}/judge`, { method: 'POST' }),
  /** Saves every thumbnail the creator takes as the winner, the first as their main pick; an empty list clears it. */
  pick: (id: string, slots: number[]) =>
    request<Run>(`/api/runs/${encodeURIComponent(id)}/pick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: slots[0] ?? null, accept: slots })
    }),
  status: () => request<Status>('/api/status')
}

/** Every thumbnail the creator picked as a winner, their main pick first; empty when they made none. */
export const pickedSlots = (run: Run) => (run.userPick ? (run.userPick.accept ?? [run.userPick.slot]) : [])

/** "thumbnail 3" or "thumbnails 3 and 7", for the picks in a line of text. */
export const slotsPhrase = (slots: number[]) =>
  slots.length === 1 ? `thumbnail ${slots[0]}` : `thumbnails ${slots.slice(0, -1).join(', ')} and ${slots[slots.length - 1]}`

/** Whether a slot starts from the nearest popular game's thumbnail. */
export const onRobloxReference = (slot: Slot) => slot.strategy === 'remix' || slot.strategy === 'meta'

/** Whether a slot starts from the style reference. */
export const onStyleReference = (slot: Slot) => slot.strategy === 'template' || slot.strategy === 'plain'

/** "Remix: Novel perspective" from "Make this thumbnail but from a novel perspective. No text."; the templates by name. */
export function strategyLabel(slot: Slot) {
  if (slot.strategy === 'template') return 'Exact template'
  if (slot.strategy === 'plain') return 'Plain template'
  if (slot.strategy === 'meta') return 'Meta: plain template'
  if (slot.strategy === 'search') return 'Meta: top search game'
  if (slot.strategy === 'typed') return 'Your exact prompt'
  if (slot.strategy === 'plain-attached') return 'Plain template on your image'
  const angle = slot.prompt.match(/\bbut (.+?)\. No text\.$/)?.[1]?.replace(/^from a\s+/i, '') ?? 'Remix'
  return `Remix: ${angle[0].toUpperCase()}${angle.slice(1)}`
}

/** A strategy by the name its tiles carry. */
export const armLabel = (arm: Arm) => strategyLabel({ slot: 0, strategy: arm, prompt: arm === 'remix' ? 'Make this thumbnail but from a novel perspective. No text.' : '' })

/** A typed-name run that draws only the selector's pick (before the pick lands, it has no slots yet). */
export const isPicked = (run: Run) => (run.mode ?? 'standard') === 'standard' && (run.selection ? !run.selection.explore : run.slots.length === 0)

/** "Thumbnail 3", "Thumbnails 2 and 4", "Thumbnails 2 to 4": slot numbers as words. */
export function slotsLabel(slots: number[]) {
  if (slots.length === 1) return `Thumbnail ${slots[0]}`
  const contiguous = slots.every((s, i) => i === 0 || s === slots[i - 1] + 1)
  if (contiguous && slots.length > 2) return `Thumbnails ${slots[0]} to ${slots.at(-1)}`
  return `Thumbnails ${slots.slice(0, -1).join(', ')} and ${slots.at(-1)}`
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
export const formatCount = (n: number) => compact.format(n)

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
export function formatAgo(iso: string) {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]]
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  return 'just now'
}

export const providerLabel = (provider: Thumbnail['provider']) => (provider === 'gemini' ? 'Gemini API' : 'fal.ai')

/** The image model a run used. */
export const runModelLabel = (run: Run) => run.imageModel?.label ?? 'Nano Banana 2'

export function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'thumbnail'
}
