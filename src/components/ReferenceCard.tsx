import { ExternalLink, Users } from 'lucide-react'
import { formatCount, type Reference } from '../lib/api'

interface ReferenceCardProps {
  reference: Reference | null
  gameName: string
  loading: boolean
}

function caption(reference: Reference, gameName: string) {
  if (reference.source === 'fallback') return `No Roblox game matches “${gameName}”, so the default reference is used.`
  const of = reference.nearCount === 1 ? 'the only close match' : `the most played of ${reference.nearCount ?? 'the'} close matches`
  return `Picked as ${of} for “${gameName}” on Roblox.`
}

export function ReferenceCard({ reference, gameName, loading }: ReferenceCardProps) {
  return (
    <section aria-labelledby="reference-title" aria-busy={loading || undefined} className="flex flex-col gap-12 rounded-16 border border-border-default bg-bg-surface p-16">
      <h2 id="reference-title" className="text-title font-semibold">Reference image</h2>

      {loading && (
        <div className="flex flex-col gap-8" aria-hidden="true">
          <div className="aspect-video w-full rounded-8 bg-border-default motion-safe:animate-pulse" />
          <div className="h-16 w-2/3 rounded-8 bg-border-default motion-safe:animate-pulse" />
          <div className="h-12 w-1/2 rounded-8 bg-border-default motion-safe:animate-pulse" />
        </div>
      )}

      {!loading && !reference && (
        <p className="text-label text-text-secondary">Each game name gets the most-played matching Roblox game as its style reference.</p>
      )}

      {!loading && reference && (
        <>
          <img
            src={reference.thumbnailUrl}
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
          <p className="text-caption text-text-secondary">{caption(reference, gameName)}</p>
        </>
      )}
    </section>
  )
}
