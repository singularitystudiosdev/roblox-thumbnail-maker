import { ExternalLink, Users } from 'lucide-react'
import { formatCount, onRobloxReference, slotsLabel, type Reference, type Run, type Slot } from '../lib/api'

interface ReferenceCardProps {
  reference: Reference | null
  /** The run's slots, to say which start from the game. */
  slots: Slot[]
  /** The creator's attached image, when the run used it as the reference for their typed prompt. */
  attached: Run['attachment'] | null
  /** The run links the creator's game, so the card shows that game rather than a nearest one. */
  linked: boolean
  loading: boolean
}

function AttachedCard({ attached, slots }: { attached: NonNullable<Run['attachment']>; slots: Slot[] }) {
  const typed = slots.filter((s) => s.strategy === 'typed').map((s) => s.slot)
  return (
    <section aria-labelledby="attached-title" className="flex flex-col gap-12 rounded-16 border border-border-default bg-bg-surface p-16">
      <h2 id="attached-title" className="text-title font-semibold">Your attached image</h2>
      <img src={attached.imageUrl} alt={`Attached reference: ${attached.name}`} width={768} height={432} className="aspect-video w-full rounded-8 object-contain" />
      <span className="truncate text-body font-medium">{attached.name}</span>
      <p className="text-caption text-text-secondary">
        {typed.length > 0
          ? `${slotsLabel(typed)} sends your prompt exactly as typed with it.`
          : 'Both thumbnails started from it: your prompt exactly as typed, then the plain template.'}
      </p>
    </section>
  )
}

function caption(reference: Reference) {
  if (reference.source === 'style') return 'No popular Roblox game is like this one right now, so the meta starts from your style image and the exact template stands in for the remix.'
  const pool = reference.candidateCount
    ? `${reference.candidateCount} of the games Roblox search returned are popular: over 300 playing, or over 10M visits with 100 playing.`
    : ''
  return [reference.why, pool].filter(Boolean).join(' ')
}

function thumbnailCaption({ index, count, why }: NonNullable<Reference['thumbnail']>) {
  if (count <= 1) return 'Its only thumbnail.'
  return `Thumbnail ${index} of ${count} on its page, the cleanest with the least text. ${why}`
}

/** Which thumbnails start from a game; empty when none do. */
function drawnLine(drawn: Slot[], what: string) {
  if (drawn.length === 0) return ''
  return `${slotsLabel(drawn.map((s) => s.slot))} start${drawn.length === 1 ? 's' : ''} from ${what}.`
}

export function ReferenceCard({ reference, slots, attached, linked, loading }: ReferenceCardProps) {
  // Attached runs saved before the meta looked up no Roblox game: the attached image is their only reference.
  if (attached && !reference && !loading) return <AttachedCard attached={attached} slots={slots} />
  return (
    <>
    {attached && (
      <div className="pb-24">
        <AttachedCard attached={attached} slots={slots} />
      </div>
    )}
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
          Before any thumbnail is drawn, the nearest popular Roblox game is looked up: the meta and the remix both start from its thumbnail.
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
          {!linked && reference.source === 'roblox' && drawnLine(slots.filter(onRobloxReference), reference.name) && (
            <p className="text-caption text-text-secondary">{drawnLine(slots.filter(onRobloxReference), reference.name)}</p>
          )}
        </>
      )}
    </section>
    </>
  )
}
