import { ImagePlus } from 'lucide-react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { ImageModelOption } from '../lib/api'
import { Button } from './Button'

interface PromptBoxProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  /** The image models to switch between; the switch hides until they load. */
  models: ImageModelOption[]
  model: string
  onModelChange: (key: string) => void
}

/** "2.1" from "Nano Banana 2.1": the group's legend carries the family name. */
const shortLabel = (label: string) => label.replace(/^Nano Banana\s*/i, '') || label

function ModelSwitch({ models, model, onModelChange, busy }: Pick<PromptBoxProps, 'models' | 'model' | 'onModelChange' | 'busy'>) {
  return (
    <fieldset disabled={busy} className="flex flex-col gap-6 px-16 pb-12">
      <legend className="pb-6 text-caption text-text-secondary">Nano Banana</legend>
      <div className="flex rounded-8 border border-border-default bg-bg-sunken p-2">
        {models.map((m) => (
          <label key={m.key} className="relative flex-1" title={m.falOnly ? `${m.label}, on fal.ai only` : m.label}>
            <input
              type="radio"
              name="image-model"
              value={m.key}
              checked={model === m.key}
              onChange={() => onModelChange(m.key)}
              aria-label={m.label}
              className="peer sr-only"
            />
            <span className="flex min-h-32 cursor-pointer items-center justify-center rounded-8 border border-transparent px-8 text-label text-text-secondary hover:text-text-primary peer-checked:border-border-strong peer-checked:bg-bg-surface peer-checked:font-medium peer-checked:text-text-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand peer-disabled:cursor-not-allowed peer-disabled:opacity-60 pointer-coarse:min-h-48">
              {shortLabel(m.label)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function PromptBox({ value, onChange, onSubmit, busy, models, model, onModelChange }: PromptBoxProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!busy && value.trim()) onSubmit()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event)
  }

  return (
    <form
      onSubmit={submit}
      data-slot="prompt-box"
      className="flex flex-col rounded-16 border border-border-default bg-bg-surface has-[textarea:focus]:outline-2 has-[textarea:focus]:outline-offset-2 has-[textarea:focus]:outline-brand"
    >
      <label htmlFor="prompt" className="px-16 pt-12 text-label font-medium text-text-secondary">
        Game name, description or Roblox link
      </label>
      <textarea
        id="prompt"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={4}
        maxLength={2000}
        placeholder="Steal an Egg, a description of your game, or https://www.roblox.com/games/…"
        className="min-h-96 resize-none bg-transparent px-16 py-8 text-body text-text-primary placeholder:text-text-quaternary focus:outline-none"
      />
      {models.length > 1 && <ModelSwitch models={models} model={model} onModelChange={onModelChange} busy={busy} />}
      <div className="flex items-center justify-end gap-12 px-12 pb-12">
        <span className="hidden text-caption text-text-secondary sm:inline" aria-hidden="true">
          <kbd className="font-sans">⌘</kbd> <kbd className="font-sans">Enter</kbd>
        </span>
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!value.trim()} aria-keyshortcuts="Meta+Enter Control+Enter">
          {!busy && <ImagePlus className="size-16" aria-hidden="true" />}
          Make 5 thumbnails
        </Button>
      </div>
    </form>
  )
}
