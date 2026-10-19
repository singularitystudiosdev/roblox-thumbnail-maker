import { Download, Trophy } from 'lucide-react'
import { providerLabel, slugify, strategyLabel, type Run, type Slot } from '../lib/api'
import { cn } from '../lib/cn'
import { buttonClasses } from './Button'

const COUNT_WORDS: Record<number, string> = { 2: 'two', 3: 'three', 4: 'four', 5: 'five' }

interface ThumbnailGridProps {
  run: Run
  busy: boolean
  shownSlot: number | null
  onShow: (slot: number) => void
}

function Tile({ run, slot, busy, shown, onShow }: { run: Run; slot: Slot; busy: boolean; shown: boolean; onShow: (slot: number) => void }) {
  const thumbnail = run.thumbnails.find((t) => t.slot === slot.slot)
  const score = run.judge?.scores?.find((s) => s.slot === slot.slot)
  const isWinner = run.judge?.winnerSlot === slot.slot
  // Runs judged on the 50-point rubric before minFitsGame was recorded used 5.
  const minFits = run.judge?.minFitsGame ?? (run.judge?.maxTotal === 50 ? 5 : null)
  const ruledOut = !isWinner && score != null && minFits != null && Number(score.fitsGame) < minFits
  const label = `Thumbnail ${slot.slot}: ${strategyLabel(slot)}`

  return (
    <li className="flex min-w-0 flex-col gap-8">
      {thumbnail?.imageUrl ? (
        <button
          type="button"
          onClick={() => onShow(slot.slot)}
          aria-pressed={shown}
          aria-label={`Show ${label} large`}
          className={cn(
            'focus-ring relative block aspect-video w-full overflow-hidden rounded-8 outline-offset-2',
            isWinner ? 'outline-2 outline-brand' : shown && 'outline-2 outline-border-strong'
          )}
        >
          <img src={thumbnail.imageUrl} alt="" width={1376} height={768} loading="lazy" className="size-full object-cover" />
          {isWinner && (
            <span className="absolute left-8 top-8 inline-flex items-center gap-4 rounded-8 bg-brand px-8 py-2 text-caption font-semibold text-on-brand">
              <Trophy className="size-12" aria-hidden="true" />
              Winner
            </span>
          )}
        </button>
      ) : thumbnail?.error ? (
        <div className="grid aspect-video w-full place-items-center rounded-8 bg-bg-canvas p-12 text-center">
          <p role="alert" className="line-clamp-4 text-caption text-destructive">{thumbnail.error}</p>
        </div>
      ) : (
        <div aria-hidden="true" className={cn('aspect-video w-full rounded-8 bg-border-default', busy && 'motion-safe:animate-pulse')} />
      )}

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-8">
          {/* The span truncates: index.css balances h3 text unlayered, which beats a utility on the h3 itself. */}
          <h3 className="min-w-0 text-label font-semibold">
            <span className="block truncate" title={label}>{label}</span>
          </h3>
          {thumbnail?.imageUrl && (
            <a
              href={thumbnail.imageUrl}
              download={`${slugify(run.gameName)}-thumbnail-${slot.slot}.png`}
              aria-label={`Download thumbnail ${slot.slot}`}
              className={buttonClasses('quiet', 'sm', 'shrink-0 pointer-coarse:min-h-48 pointer-coarse:min-w-48')}
            >
              <Download className="size-16" aria-hidden="true" />
            </a>
          )}
        </div>
        <p className="rounded-8 bg-bg-canvas px-8 py-4 text-caption text-text-primary">{slot.prompt}</p>
        <p className="text-caption text-text-secondary">
          Reference: {thumbnail?.referenceName ?? (slot.strategy === 'remix' ? run.reference?.name ?? 'finding it' : run.style.name)}
        </p>
        {thumbnail?.provider && (
          <p className="text-caption text-text-secondary">
            Nano Banana 2 on {providerLabel(thumbnail.provider)} in {Math.round(thumbnail.ms / 1000)}s
          </p>
        )}
        {score && (
          <p className="text-caption text-text-secondary">
            <span className={cn('font-semibold', isWinner ? 'text-brand' : 'text-text-primary')}>
              Judge {Math.round(score.total)}/{run.judge?.maxTotal ?? 40}.
            </span>{' '}
            {score.note}
          </p>
        )}
        {ruledOut && (
          <p className="text-caption font-semibold text-text-primary">Ruled out: it does not show this game, so its other scores cannot make it win.</p>
        )}
      </div>
    </li>
  )
}

export function ThumbnailGrid({ run, busy, shownSlot, onShow }: ThumbnailGridProps) {
  return (
    <section aria-labelledby="all-thumbnails-title" className="flex flex-col gap-16 rounded-16 border border-border-default bg-bg-surface p-16">
      <h2 id="all-thumbnails-title" className="text-title font-semibold">
        All {COUNT_WORDS[run.slots.length] ?? run.slots.length} thumbnails
      </h2>
      {/* Five sit three then two, older runs of four two by two, of three in one row. */}
      <ul className={cn('grid grid-cols-1 gap-24 sm:gap-16', run.slots.length === 4 ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
        {run.slots.map((slot) => (
          <Tile key={slot.slot} run={run} slot={slot} busy={busy} shown={shownSlot === slot.slot} onShow={onShow} />
        ))}
      </ul>
    </section>
  )
}
