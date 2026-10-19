import { ExternalLink, Users } from 'lucide-react'
import { formatCount, type Reference, type Run } from '../lib/api'

interface ReferenceCardProps {
  reference: Reference | null
  /** The search meta's game (thumbnail 3); runs saved before it have none. */
  searchReference: Reference | null
  /** The creator's attached image, when the run used it as the reference instead of a Roblox game. */
  attached: Run['attachment'] | null
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

/** The search meta's game in one line: which game thumbnail 3 starts from, and why. */
function searchLine(search: Reference) {
  if (search.source === 'style') return 'Thumbnail 3: no other game in a plain Roblox search, so it starts from your reference image.'
  const playing = search.playing != null ? ` (${formatCount(search.playing)} playing)` : ''
  return `Thumbnail 3 starts from ${search.name}${playing}. ${search.why ?? ''}`.trim()
}

export function ReferenceCard({ reference, searchReference, attached, loading }: ReferenceCardProps) {
  if (attached) return <AttachedCard attached={attached} />
  return (
    <section aria-labelledby="reference-title" aria-busy={loading || undefined} className="flex flex-col gap-12 rounded-16 border border-border-default bg-bg-surface p-16">
      <h2 id="reference-title" className="text-title font-semibold">Nearest popular game</h2>

      {loading && (
        <div className="flex flex-col gap-8" aria-hidden="true">
          <div className="aspect-video w-full rounded-8 bg-border-default motion-safe:animate-pulse" />
          <div className="h-16 w-2/3 rounded-8 bg-border-default motion-safe:animate-pulse" />
          <div className="h-12 w-1/2 rounded-8 bg-border-default motion-safe:animate-pulse" />
        </div>
      )}

      {!loading && !reference && (
        <p className="text-label text-text-secondary">
          Thumbnails 2 and 4 start from the thumbnail of a popular Roblox game like yours; thumbnail 3 from the top game of a plain Roblox search.
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
          {searchReference && <p className="text-caption text-text-secondary">{searchLine(searchReference)}</p>}
        </>
      )}
    </section>
  )
}
