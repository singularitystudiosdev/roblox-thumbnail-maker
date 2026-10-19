import { ExternalLink, Users } from 'lucide-react'
import { formatCount, onRobloxReference, slotsLabel, type Reference, type Run, type Slot } from '../lib/api'

interface ReferenceCardProps {
  reference: Reference | null
  /** The search meta's game; runs saved before it have none. */
  searchReference: Reference | null
  /** The run's slots, to say which start from each game; a picked run has none until its pick lands. */
  slots: Slot[]
  /** The creator's attached image, when the run used it as the reference instead of a Roblox game. */
  attached: Run['attachment'] | null
  /** The run links the creator's game, so the card shows that game rather than a nearest one. */
  linked: boolean
  loading: boolean
}

function AttachedCard({ attached }: { attached: NonNullable<Run['attachment']> }) {
  return (
    <section aria-labelledby="reference-title" className="flex flex-col gap-12 rounded-16 border border-border-default bg-bg-surface p-16">
      <h2 id="reference-title" className="text-title font-semibold">Your attached image</h2>
      <img src={attached.imageUrl} alt={`Attached reference: ${attached.name}`} width={768} height={432} className="aspect-video w-full rounded-8 object-contain" />
      <span className="truncate text-body font-medium">{attached.name}</span>
      <p className="text-caption text-text-secondary">
        Both thumbnails start from it: thumbnail 1 sends your prompt exactly as typed, thumbnail 2 the plain template. No Roblox game is looked up.
      </p>
    </section>
  )
}

function caption(reference: Reference) {
  if (reference.source === 'style') return 'No popular Roblox game is like this one right now, so the remixes start from your reference image.'
  const pool = reference.candidateCount
    ? `${reference.candidateCount} of the games Roblox search returned are popular: over 300 playing, or over 10M visits with 100 playing.`
    : ''
  return [reference.why, pool].filter(Boolean).join(' ')
}

function thumbnailCaption({ index, count, why }: NonNullable<Reference['thumbnail']>) {
  if (count <= 1) return 'Its only thumbnail.'
  return `Thumbnail ${index} of ${count} on its page, the cleanest with the least text. ${why}`
}

/** Which thumbnails start from a game, or that none do this run (it was only rated for the pick). */
function drawnLine(slots: Slot[], drawn: Slot[], what: string) {
  if (slots.length === 0) return ''
  if (drawn.length === 0) return `No thumbnail starts from ${what} this run: it was rated for the pick only.`
  return `${slotsLabel(drawn.map((s) => s.slot))} start${drawn.length === 1 ? 's' : ''} from ${what}.`
}

/** The search meta's game in one line: which thumbnails start from it, and why it is the one. */
function searchLine(search: Reference, slots: Slot[]) {
  if (search.source === 'style') return 'No other game in a plain Roblox search.'
  const playing = search.playing != null ? ` (${formatCount(search.playing)} playing)` : ''
  const drawn = drawnLine(slots, slots.filter((s) => s.strategy === 'search'), 'it')
  return `Top search game: ${search.name}${playing}. ${drawn} ${search.why ?? ''}`.replace(/\s+/g, ' ').trim()
}

export function ReferenceCard({ reference, searchReference, slots, attached, linked, loading }: ReferenceCardProps) {
  if (attached) return <AttachedCard attached={attached} />
  return (
    <section aria-labelledby="reference-title" aria-busy={loading || undefined} className="flex flex-col gap-12 rounded-16 border border-border-default bg-bg-surface p-16">
      <h2 id="reference-title" className="text-title font-semibold">
        {linked ? 'Your linked game' : 'Nearest popular game'}
      </h2>

      {loading && (
        <div className="flex flex-col gap-8" aria-hidden="true">
          <div className="aspect-video w-full rounded-8 bg-border-default motion-safe:animate-pulse" />
          <div className="h-16 w-2/3 rounded-8 bg-border-default motion-safe:animate-pulse" />
          <div className="h-12 w-1/2 rounded-8 bg-border-default motion-safe:animate-pulse" />
        </div>
      )}

      {!loading && !reference && (
        <p className="text-label text-text-secondary">
          Before any thumbnail is drawn, the nearest popular Roblox game and the top game of a plain Roblox search are looked up and rated against yours to pick the strategy.
        </p>
      )}

      {!loading && reference && (
        <>
          <img
            src={reference.imageUrl}
            alt={`Reference thumbnail: ${reference.name}`}
            width={768}
            height={432}
            className="aspect-video w-full rounded-8 object-cover"
          />
          <div className="flex items-start justify-between gap-12">
            <div className="flex min-w-0 flex-col gap-4">
              <span className="text-body font-medium">{reference.name}</span>
              {reference.source === 'roblox' && reference.playing != null && (
                <span className="inline-flex items-center gap-4 text-caption text-text-secondary">
                  <Users className="size-12" aria-hidden="true" />
                  {formatCount(reference.playing)} playing now
                </span>
              )}
            </div>
            {reference.url && (
              <a
                href={reference.url}
                target="_blank"
                rel="noreferrer"
                className="focus-ring inline-flex min-h-32 shrink-0 items-center gap-4 rounded-8 px-8 text-label text-text-secondary hover:text-text-primary pointer-coarse:min-h-48"
              >
                <ExternalLink className="size-12" aria-hidden="true" />
                Roblox page
              </a>
            )}
          </div>
          <p className="text-caption text-text-secondary">{caption(reference)}</p>
          {reference.thumbnail && <p className="text-caption text-text-secondary">{thumbnailCaption(reference.thumbnail)}</p>}
          {!linked && reference.source === 'roblox' && slots.length > 0 && (
            <p className="text-caption text-text-secondary">{drawnLine(slots, slots.filter(onRobloxReference), reference.name)}</p>
          )}
          {searchReference && <p className="text-caption text-text-secondary">{searchLine(searchReference, slots)}</p>}
        </>
      )}
    </section>
  )
}
