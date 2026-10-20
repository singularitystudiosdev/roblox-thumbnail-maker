import { Check, Circle, LoaderCircle, Trophy, X } from 'lucide-react'
import { useState } from 'react'
import { slotsLabel, strategyLabel, type Run } from '../lib/api'
import { cn } from '../lib/cn'
import { Button } from './Button'

export type Phase = 'idle' | 'running' | 'judging' | 'done' | 'error'
type StepState = 'pending' | 'active' | 'done' | 'failed'

interface WinnerStageProps {
  phase: Phase
  run: Run | null
  shownSlot: number | null
  elapsed: number
  error: string | null
  onExample: () => void
  onRetry: () => void
}

const STEP_ICON: Record<StepState, typeof Check> = { pending: Circle, active: LoaderCircle, done: Check, failed: X }

function slotState(run: Run | null, slots: number[]): StepState {
  const landed = slots.map((n) => run?.thumbnails.find((t) => t.slot === n))
  if (landed.some((t) => !t)) return 'active'
  return landed.every((t) => t?.error) ? 'failed' : 'done'
}

/** The Roblox game both thumbnails start from, in words: the creator's linked game, the nearest popular one, or none. */
function referenceStep(run: Run | null): { label: string; state: StepState } {
  const reference = run?.reference
  if (run?.mode === 'linked') return { label: reference ? `Your game's thumbnail: ${reference.name}` : "Fetching your game's thumbnail", state: reference ? 'done' : 'active' }
  if (!reference) return { label: 'Finding the nearest popular Roblox game', state: run ? 'active' : 'pending' }
  if (reference.source === 'style') return { label: 'No popular Roblox game like yours: your style image instead', state: 'done' }
  return { label: `Nearest popular game: ${reference.name}`, state: 'done' }
}

/** The meta and the remix on the Roblox reference, and the creator's typed prompt on their attached image when there is one. */
function steps(run: Run | null, phase: Phase) {
  const judgeStep = { label: 'Judge picks the winner', state: phase === 'judging' ? 'active' : run?.judge ? 'done' : 'pending' } satisfies { label: string; state: StepState }
  const typed = run?.slots.filter((s) => s.strategy === 'typed').map((s) => s.slot) ?? []
  const onReference = run?.slots.filter((s) => s.strategy !== 'typed') ?? []
  const fromIt = onReference.length > 0 ? `${slotsLabel(onReference.map((s) => s.slot))}: ${onReference.map(strategyLabel).join(', ')}` : 'Thumbnails 1 and 2: Meta: plain template, Remix: Novel perspective'
  return [
    { label: run ? `Game name: ${run.gameName}` : 'Reading the game name', state: run ? 'done' : 'active' },
    referenceStep(run),
    ...(run && typed.length > 0 ? [{ label: `${slotsLabel(typed)}: your exact prompt on your attached image`, state: slotState(run, typed) }] : []),
    { label: fromIt, state: run?.reference ? slotState(run, onReference.map((s) => s.slot)) : 'pending' },
    judgeStep
  ] satisfies { label: string; state: StepState }[]
}

function Progress({ run, phase, elapsed }: { run: Run | null; phase: Phase; elapsed: number }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-bg-canvas p-24">
      <div role="status" className="flex w-full max-w-sm flex-col gap-12">
        <ol className="flex flex-col gap-8">
          {steps(run, phase).map(({ label, state }) => {
            const Icon = STEP_ICON[state]
            return (
              <li key={label} className="flex min-w-0 items-center gap-8 text-label">
                <Icon
                  aria-hidden="true"
                  className={cn(
                    'size-16 shrink-0',
                    state === 'active' && 'text-brand motion-safe:animate-spin',
                    state === 'done' && 'text-brand',
                    state === 'pending' && 'text-text-quaternary',
                    state === 'failed' && 'text-destructive'
                  )}
                />
                <span className={cn('truncate', state === 'pending' ? 'text-text-secondary' : 'text-text-primary')}>{label}</span>
              </li>
            )
          })}
        </ol>
        <p className="text-caption text-text-secondary">{elapsed}s elapsed</p>
      </div>
    </div>
  )
}

export function WinnerStage({ phase, run, shownSlot, elapsed, error, onExample, onRetry }: WinnerStageProps) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const busy = phase === 'running' || phase === 'judging'
  const shown = run?.thumbnails.find((t) => t.slot === shownSlot && t.imageUrl)
  const isWinner = shown != null && shown.slot === run?.judge?.winnerSlot

  return (
    <div data-slot="winner-stage" className="relative aspect-video w-full overflow-hidden rounded-16 border border-border-default bg-bg-surface">
      {phase === 'idle' && !run && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-16 p-24 text-center">
          <p className="max-w-prose text-body text-text-secondary">
            One prompt makes two thumbnails from the most popular Roblox game like yours, and the judge puts the better one here.
          </p>
          <Button onClick={onExample}>Try an example</Button>
        </div>
      )}

      {!busy && shown?.imageUrl && (
        <>
          <img
            key={shown.imageUrl}
            src={shown.imageUrl}
            alt={`Thumbnail ${shown.slot} for ${run?.gameName}, ${strategyLabel(shown)}`}
            width={1376}
            height={768}
            onLoad={() => setLoadedUrl(shown.imageUrl ?? null)}
            data-motion="fade-in"
            className={cn(
              'size-full object-cover transition-opacity duration-200 ease-standard motion-reduce:transition-none',
              loadedUrl === shown.imageUrl ? 'opacity-100' : 'opacity-0'
            )}
          />
          <span
            className={cn(
              'absolute left-12 top-12 inline-flex items-center gap-4 rounded-8 px-8 py-4 text-label font-semibold',
              isWinner ? 'bg-brand text-on-brand' : 'bg-bg-canvas text-text-primary'
            )}
          >
            {isWinner && <Trophy className="size-16" aria-hidden="true" />}
            {isWinner ? `Winner: Thumbnail ${shown.slot}` : `Thumbnail ${shown.slot}`}
          </span>
        </>
      )}

      {busy && <Progress run={run} phase={phase} elapsed={elapsed} />}

      {phase === 'error' && !shown && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-16 bg-bg-surface p-24 text-center">
          <p role="alert" className="max-w-prose text-body text-destructive">{error}</p>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}
    </div>
  )
}
