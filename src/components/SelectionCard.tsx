import { armLabel, type Arm, type Selection } from '../lib/api'
import { cn } from '../lib/cn'

interface SelectionCardProps {
  selection: Selection | null
  loading: boolean
}

const rating = (value: number | null) => (value == null ? 'none' : `${value} of 10`)

/** The prompt type in words, as the pick read it; which strategy wins for each type is learned, never fixed here. */
function typeLine(type: NonNullable<Selection['type']>) {
  if (type.match === 'exact') return `Read as a game that exists on Roblox: ${type.game ?? 'a game with this exact name'}.`
  if (type.descriptive) return 'Read as a description: no Roblox game has this name.'
  return type.match === 'near' ? 'Read as a short name that partly matches Roblox games.' : 'Read as a short name no Roblox game shares.'
}

/** Strategies by expected points lost, fewest first. */
function ranked(expected: Record<Arm, number>) {
  return (Object.entries(expected) as [Arm, number][]).sort((a, b) => a[1] - b[1])
}

function Picked({ selection }: { selection: Selection }) {
  const { arm, explore, expected, fit, closest, examples } = selection
  return (
    <>
      <p className="text-body">
        {explore ? (
          <>
            This run drew all seven strategies so the pick keeps learning. It would have picked <span className="font-semibold">{armLabel(arm)}</span>.
          </>
        ) : (
          <>
            Picked <span className="font-semibold">{armLabel(arm)}</span>: both thumbnails use it.
          </>
        )}
      </p>
      {selection.type && <p className="text-label">{typeLine(selection.type)}</p>}
      {expected ? (
        <>
          <ol className="flex flex-col gap-4" aria-label="Expected points lost per strategy">
            {ranked(expected).map(([a, points]) => (
              <li key={a} className={cn('flex items-baseline justify-between gap-12 text-label', a === arm ? 'font-semibold text-brand' : 'text-text-secondary')}>
                <span className="min-w-0 truncate">{armLabel(a)}</span>
                <span className="shrink-0 tabular-nums">{points.toFixed(1)}</span>
              </li>
            ))}
          </ol>
          <p className="text-caption text-text-secondary">
            Judge points out of 50 each strategy is expected to fall short of drawing all seven, learned from {examples} runs that drew every strategy.
          </p>
        </>
      ) : (
        <p className="text-caption text-text-secondary">The references could not be rated, so it picked meta, the best single strategy so far.</p>
      )}
      {selection.topUp && (
        <p className="text-label">
          Both scored under {selection.topUp.below} of 50 (best {selection.topUp.best}), so two more were drawn with{' '}
          <span className="font-semibold">{armLabel(selection.topUp.arm)}</span>, the next best strategy.
        </p>
      )}
      {fit && (
        <p className="text-caption text-text-secondary">
          Nearest game {rating(fit.nearestFit)}, search game {rating(fit.searchFit)}, the name alone {rating(fit.nameClarity)}. {fit.why}
        </p>
      )}
      {closest.length > 0 && (
        <p className="text-caption text-text-secondary">
          Most like: {closest.map((c) => `${c.game} (${armLabel(c.winner).toLowerCase()} won)`).join(', ')}.
        </p>
      )}
    </>
  )
}

export function SelectionCard({ selection, loading }: SelectionCardProps) {
  return (
    <section aria-labelledby="selection-title" aria-busy={loading || undefined} className="flex flex-col gap-12 rounded-16 border border-border-default bg-bg-surface p-16">
      <h2 id="selection-title" className="text-title font-semibold">Strategy</h2>
      {selection ? (
        <Picked selection={selection} />
      ) : loading ? (
        <div className="flex flex-col gap-8" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="h-12 w-full rounded-8 bg-border-default motion-safe:animate-pulse" />
          ))}
        </div>
      ) : (
        <p className="text-label text-text-secondary">This run drew every strategy, before the pick existed.</p>
      )}
    </section>
  )
}
