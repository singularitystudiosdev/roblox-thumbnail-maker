import { ExternalLink, Users } from 'lucide-react'
import { formatCount, type Reference } from '../lib/api'

interface ReferenceCardProps {
  reference: Reference | null
  loading: boolean
}

function caption(reference: Reference) {
  if (reference.source === 'style') return 'No Roblox game like this one has over 300 players right now, so the remixes start from your reference image.'
  const pool = reference.candidateCount ? `${reference.candidateCount} of the games Roblox search returned have over 300 players.` : ''
  return [reference.why, pool].filter(Boolean).join(' ')
}

function thumbnailCaption({ index, count, why }: NonNullable<Reference['thumbnail']>) {
  if (count <= 1) return 'Its only thumbnail.'
  return `Thumbnail ${index} of ${count} on its page, the cleanest with the least text. ${why}`
}

export function ReferenceCard({ reference, loading }: ReferenceCardProps) {
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
        <p className="text-label text-text-secondary">Thumbnails 2 and 3 remix the thumbnail of the nearest, most played Roblox game to yours.</p>
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
        </>
      )}
    </section>
  )
}
