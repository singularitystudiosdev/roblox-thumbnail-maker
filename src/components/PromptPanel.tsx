import { Check, Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { buildPrompt } from '../../server/prompt.mjs'
import { formatCount, type DescribedFrom } from '../lib/api'

interface PromptPanelProps {
  modelName: string
  gameName: string
  onGameName: (value: string) => void
  describedFrom: DescribedFrom | null
}

export function PromptPanel({ modelName, gameName, onGameName, describedFrom }: PromptPanelProps) {
  const [copied, setCopied] = useState(false)
  const prompt = gameName.trim().replace(/^["“”']+|["“”']+$/g, '').trim() ? buildPrompt(gameName) : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('Clipboard write failed', err)
    }
  }

  return (
    <section aria-labelledby="prompt-title" className="flex flex-col gap-16 rounded-16 border border-border-default bg-bg-surface p-16">
      <h2 id="prompt-title" className="text-title font-semibold">Sent to {modelName}</h2>

      <div className="flex flex-col gap-4 sm:max-w-sm">
        <label htmlFor="game-name" className="text-label font-medium text-text-secondary">Game name</label>
        <input
          id="game-name"
          value={gameName}
          onChange={(e) => onGameName(e.target.value)}
          className="focus-ring w-full rounded-8 border border-border-default bg-bg-canvas px-12 py-8 text-body text-text-primary sm:text-label"
        />
        {describedFrom ? (
          <p className="flex flex-wrap items-center gap-4 text-caption text-text-secondary">
            Written from the description of
            <a href={describedFrom.url} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-4 rounded-8 font-medium text-text-primary hover:underline">
              {describedFrom.name}
              <ExternalLink className="size-12" aria-hidden="true" />
            </a>
            <span>({formatCount(describedFrom.playing)} playing)</span>
          </p>
        ) : (
          <p className="text-caption text-text-secondary">Edit it and Regenerate to send your own wording as is.</p>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-8">
          <span id="exact-prompt" className="text-label font-medium text-text-secondary">Exact prompt</span>
          <button
            type="button"
            onClick={copy}
            disabled={!prompt}
            aria-label={copied ? 'Prompt copied' : 'Copy prompt'}
            className="focus-ring grid size-32 place-items-center rounded-8 text-text-secondary transition-colors duration-100 hover:bg-bg-canvas hover:text-text-primary pointer-coarse:size-48"
          >
            {copied ? <Check className="size-16 text-brand" aria-hidden="true" /> : <Copy className="size-16" aria-hidden="true" />}
          </button>
        </div>
        <p aria-labelledby="exact-prompt" className="rounded-8 bg-bg-canvas p-12 text-label text-text-primary">
          {prompt || 'Give the game a name to build the prompt.'}
        </p>
      </div>
    </section>
  )
}
