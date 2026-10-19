import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import type { Generation } from '../lib/api'
import { cn } from '../lib/cn'
import { Button } from './Button'

export type Phase = 'idle' | 'planning' | 'generating' | 'done' | 'error'

interface ResultStageProps {
  phase: Phase
  result: Generation | null
  gameName: string
  modelName: string
  elapsed: number
  error: string | null
  onExample: () => void
  onRetry: () => void
}

function Working({ label, elapsed }: { label: string; elapsed: number }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="absolute inset-0 bg-border-default motion-safe:animate-pulse" aria-hidden="true" />
      <div role="status" className="relative flex flex-col items-center gap-8 px-24 text-center">
        <LoaderCircle className="size-24 text-brand motion-safe:animate-spin" aria-hidden="true" />
        <p className="text-body font-medium">{label}</p>
        <p className="text-caption text-text-secondary">{elapsed}s elapsed</p>
      </div>
    </div>
  )
}

export function ResultStage({ phase, result, gameName, modelName, elapsed, error, onExample, onRetry }: ResultStageProps) {
  const [loadedId, setLoadedId] = useState<string | null>(null)

  return (
    <div data-slot="result-stage" className="relative aspect-video w-full overflow-hidden rounded-16 border border-border-default bg-bg-surface">
      {phase === 'idle' && !result && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-16 p-24 text-center">
          <p className="max-w-prose text-body text-text-secondary">
            Type your game name and its thumbnail lands here, styled after the most-played matching Roblox game.
          </p>
          <Button onClick={onExample}>Try an example</Button>
        </div>
      )}

      {result && phase !== 'planning' && phase !== 'generating' && (
        <img
          key={result.id}
          src={result.imageUrl}
          alt={`Generated thumbnail for ${result.gameName}`}
          width={1376}
          height={768}
          onLoad={() => setLoadedId(result.id)}
          data-motion="fade-in"
          className={cn(
            'size-full object-cover transition-opacity duration-200 ease-standard motion-reduce:transition-none',
            loadedId === result.id ? 'opacity-100' : 'opacity-0'
          )}
        />
      )}

      {phase === 'planning' && <Working label="Finding the most-played matching Roblox game" elapsed={elapsed} />}
      {phase === 'generating' && <Working label={`${modelName} is drawing ${gameName}`} elapsed={elapsed} />}

      {phase === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-16 bg-bg-surface p-24 text-center">
          <p role="alert" className="max-w-prose text-body text-destructive">{error}</p>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}
    </div>
  )
}
