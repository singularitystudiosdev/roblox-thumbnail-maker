import { ImagePlus } from 'lucide-react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Button } from './Button'

interface PromptBoxProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
}

export function PromptBox({ value, onChange, onSubmit, busy }: PromptBoxProps) {
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
      className="flex flex-col rounded-16 border border-border-default bg-bg-surface focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand"
    >
      <label htmlFor="prompt" className="px-16 pt-12 text-label font-medium text-text-secondary">
        Game name
      </label>
      <textarea
        id="prompt"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={4}
        placeholder="Rob a Bank"
        className="min-h-96 resize-none bg-transparent px-16 py-8 text-body text-text-primary placeholder:text-text-quaternary focus:outline-none"
      />
      <div className="flex items-center justify-end gap-12 px-12 pb-12">
        <span className="hidden text-caption text-text-secondary sm:inline" aria-hidden="true">
          <kbd className="font-sans">⌘</kbd> <kbd className="font-sans">Enter</kbd>
        </span>
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!value.trim()} aria-keyshortcuts="Meta+Enter Control+Enter">
          {!busy && <ImagePlus className="size-16" aria-hidden="true" />}
          Generate
        </Button>
      </div>
    </form>
  )
}
