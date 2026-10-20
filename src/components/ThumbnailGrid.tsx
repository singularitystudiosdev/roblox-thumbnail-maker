import { Download, ThumbsUp, Trophy } from 'lucide-react'
import { onRobloxReference, pickedSlots, providerLabel, runModelLabel, slugify, strategyLabel, type Run, type Slot } from '../lib/api'
import { cn } from '../lib/cn'

/** The reference a slot will start from, before its thumbnail lands. */
function pendingReference(slot: Slot, run: Run) {
  if (slot.strategy === 'typed') return run.attachment?.name ?? 'your attached image'
  if (run.mode === 'linked') return run.reference?.name ?? 'your linked game'
  if (onRobloxReference(slot)) return run.reference?.name ?? 'finding it'
  return run.style.name
}
import { buttonClasses } from './Button'

const COUNT_WORDS: Record<number, string> = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven' }

interface ThumbnailGridProps {
  run: Run
  busy: boolean
  shownSlot: number | null
  onShow: (slot: number) => void
  /** Saves every thumbnail the creator takes as the winner (empty clears it); the judge sees them as worked examples. */
  onPick: (slots: number[]) => void
}

interface TileProps {
  run: Run
  slot: Slot
  busy: boolean
  shown: boolean
  onShow: (slot: number) => void
  onPick: (slots: number[]) => void
}

function Tile({ run, slot, busy, shown, onShow, onPick }: TileProps) {
  const thumbnail = run.thumbnails.find((t) => t.slot === slot.slot)
  const score = run.judge?.scores?.find((s) => s.slot === slot.slot)
  const isWinner = run.judge?.winnerSlot === slot.slot
  const picked = pickedSlots(run)
  const isUserPick = picked.includes(slot.slot)
  // Agreeing with the judge needs no click; any other finished thumbnail can be picked instead, and once
  // one is picked, more can join it.
  const canPick = !busy && Boolean(thumbnail?.imageUrl) && !isUserPick && !(isWinner && picked.length === 0)
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
          {isUserPick && (
            <span className="absolute right-8 top-8 inline-flex items-center gap-4 rounded-8 bg-bg-canvas px-8 py-2 text-caption font-semibold text-text-primary">
              <ThumbsUp className="size-12" aria-hidden="true" />
              Your pick
            </span>
          )}
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
          Reference: {thumbnail?.referenceName ?? pendingReference(slot, run)}
        </p>
        {slot.fallback && <p className="text-caption text-text-secondary">{slot.fallback}</p>}
        {thumbnail?.imageUrl && !thumbnail.iconUrl && busy && run.winnerSlot === slot.slot && (
          <div className="flex items-center gap-8">
            <div aria-hidden="true" className="size-48 shrink-0 rounded-8 bg-border-default motion-safe:animate-pulse" />
            <span className="text-caption text-text-secondary">Making the 512 × 512 icon</span>
          </div>
        )}
        {thumbnail?.iconUrl && (
          <div className="flex items-center gap-8">
            <img
              src={thumbnail.iconUrl}
              alt={`Icon from thumbnail ${slot.slot}`}
              width={512}
              height={512}
              loading="lazy"
              className="size-48 shrink-0 rounded-8 object-cover"
            />
            <span className="min-w-0 flex-1 text-caption text-text-secondary">
              {thumbnail.iconRedrawn === false ? '512 × 512 icon, the thumbnail fitted whole' : '512 × 512 icon, redrawn square'}
            </span>
            <a
              href={thumbnail.iconUrl}
              download={`${slugify(run.gameName)}-icon-${slot.slot}.png`}
              aria-label={`Download icon ${slot.slot}`}
              className={buttonClasses('quiet', 'sm', 'shrink-0 pointer-coarse:min-h-48')}
            >
              <Download className="size-16" aria-hidden="true" />
              Icon
            </a>
          </div>
        )}
        {thumbnail?.provider && (
          <p className="text-caption text-text-secondary">
            {runModelLabel(run)} on {providerLabel(thumbnail.provider)} in {Math.round(thumbnail.ms / 1000)}s
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
        {canPick && (
          <button
            type="button"
            onClick={() => onPick([...picked, slot.slot])}
            className={buttonClasses('quiet', 'sm', 'self-start pointer-coarse:min-h-48')}
          >
            <ThumbsUp className="size-16" aria-hidden="true" />
            {picked.length === 0 ? 'Should have won' : 'Also my pick'}
          </button>
        )}
        {isUserPick && !busy && (
          <button
            type="button"
            onClick={() => onPick(picked.filter((s) => s !== slot.slot))}
            className={buttonClasses('quiet', 'sm', 'self-start pointer-coarse:min-h-48')}
          >
            Undo my pick
          </button>
        )}
        {ruledOut && (
          <p className="text-caption font-semibold text-text-primary">Ruled out: it does not show this game, so its other scores cannot make it win.</p>
        )}
      </div>
    </li>
  )
}

export function ThumbnailGrid({ run, busy, shownSlot, onShow, onPick }: ThumbnailGridProps) {
  return (
    <section aria-labelledby="all-thumbnails-title" className="flex flex-col gap-16 rounded-16 border border-border-default bg-bg-surface p-16">
      <h2 id="all-thumbnails-title" className="text-title font-semibold">
        {run.slots.length === 2 ? 'Both thumbnails' : `All ${COUNT_WORDS[run.slots.length] ?? run.slots.length} thumbnails`}
      </h2>
      {/* Seven sit three, three then one, five three then two, older runs of four two by two, of three in one row. */}
      <ul className={cn('grid grid-cols-1 gap-24 sm:gap-16', run.slots.length === 4 || run.slots.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
        {run.slots.map((slot) => (
          <Tile key={slot.slot} run={run} slot={slot} busy={busy} shown={shownSlot === slot.slot} onShow={onShow} onPick={onPick} />
        ))}
      </ul>
    </section>
  )
}
