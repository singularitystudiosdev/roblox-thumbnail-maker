import { Check, Circle, LoaderCircle, Trophy, X } from 'lucide-react'
import { useState } from 'react'
import { onRobloxReference, onStyleReference, strategyLabel, type Run } from '../lib/api'
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

/** "Thumbnail 3", "Thumbnails 2 and 4", "Thumbnails 2 to 4": slot numbers as words. */
function thumbnailsLabel(slots: number[]) {
  if (slots.length === 1) return `Thumbnail ${slots[0]}`
  const contiguous = slots.every((s, i) => i === 0 || s === slots[i - 1] + 1)
  if (contiguous && slots.length > 2) return `Thumbnails ${slots[0]} to ${slots.at(-1)}`
  return `Thumbnails ${slots.slice(0, -1).join(', ')} and ${slots.at(-1)}`
}

function steps(run: Run | null, phase: Phase) {
  const judgeStep = { label: 'Judge picks the winner', state: phase === 'judging' ? 'active' : run?.judge ? 'done' : 'pending' } satisfies { label: string; state: StepState }
  if (run?.mode === 'attached') {
    return [
      { label: `Game name: ${run.gameName}`, state: 'done' },
      { label: 'Thumbnails 1 and 2 from your attached image', state: slotState(run, run.slots.map((s) => s.slot)) },
      judgeStep
    ] satisfies { label: string; state: StepState }[]
  }
  if (run?.mode === 'linked') {
    const linkedRef = run.reference
    return [
      { label: `Game name: ${run.gameName}`, state: 'done' },
      { label: linkedRef ? `Your game's thumbnail: ${linkedRef.name}` : "Fetching your game's thumbnail", state: linkedRef ? 'done' : 'active' },
      { label: `${thumbnailsLabel(run.slots.map((s) => s.slot))} from it`, state: linkedRef ? slotState(run, run.slots.map((s) => s.slot)) : 'pending' },
      judgeStep
    ] satisfies { label: string; state: StepState }[]
  }
  const reference = run?.reference
  const searchReference = run?.searchReference
  // Older runs have three or two remixes and no search meta.
  const robloxSlots = run?.slots.filter(onRobloxReference).map((s) => s.slot) ?? [2, 4]
  const searchSlots = run?.slots.filter((s) => s.strategy === 'search').map((s) => s.slot) ?? [3]
  // Older runs have the exact template only.
  const styleSlots = run?.slots.filter(onStyleReference).map((s) => s.slot) ?? [1, 5]
  const styleLabel = styleSlots.length === 1 ? 'Thumbnail 1 from the exact template' : `Thumbnails ${styleSlots.join(' and ')} from your reference image`
  const searchStep =
    searchSlots.length === 0
      ? []
      : [
          {
            label: searchReference ? `${thumbnailsLabel(searchSlots)} from the top search game: ${searchReference.name}` : `Searching Roblox for ${thumbnailsLabel(searchSlots).toLowerCase()}`,
            state: searchReference ? slotState(run, searchSlots) : run ? 'active' : 'pending'
          } satisfies { label: string; state: StepState }
        ]
  return [
    { label: run ? `Game name: ${run.gameName}` : 'Reading the game name', state: run ? 'done' : 'active' },
    { label: styleLabel, state: run ? slotState(run, styleSlots) : 'pending' },
    { label: reference ? `Nearest popular game: ${reference.name}` : 'Finding the nearest popular Roblox game', state: reference ? 'done' : run ? 'active' : 'pending' },
    { label: `${thumbnailsLabel(robloxSlots)} made from it`, state: reference ? slotState(run, robloxSlots) : 'pending' },
    ...searchStep,
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
            One prompt makes five thumbnails and the judge puts the most clickable one here.
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
