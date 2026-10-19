import { ImagePlus, Paperclip, X } from 'lucide-react'
import { useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import type { StyleUpload } from '../lib/api'
import { IMAGE_TYPES, readImageFile } from '../lib/files'
import { Button, buttonClasses } from './Button'

interface PromptBoxProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  /** The image attached to the prompt: the reference when the prompt asks for it. */
  attachment: StyleUpload | null
  onAttach: (attachment: StyleUpload | null) => void
}

export function PromptBox({ value, onChange, onSubmit, busy, attachment, onAttach }: PromptBoxProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!busy && value.trim()) onSubmit()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event)
  }
  const attach = async (file: File | undefined | null) => {
    if (!file) return
    try {
      onAttach(await readImageFile(file))
      setError(null)
    } catch (err) {
      console.error('Attached image read failed', err)
      setError((err as Error).message)
    }
  }
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    void attach(file)
  }
  // A pasted image attaches; pasted text types as usual.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = [...event.clipboardData.files].find((f) => f.type.startsWith('image/'))
    if (!file || busy) return
    event.preventDefault()
    void attach(file)
  }
  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    const file = [...event.dataTransfer.files].find((f) => f.type.startsWith('image/'))
    if (!file) return
    event.preventDefault()
    if (!busy) void attach(file)
  }

  return (
    <form
      onSubmit={submit}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      data-slot="prompt-box"
      className="@container flex flex-col rounded-16 border border-border-default bg-bg-surface focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand"
    >
      <label htmlFor="prompt" className="px-16 pt-12 text-label font-medium text-text-secondary">
        Game name, description or Roblox link
      </label>
      <textarea
        id="prompt"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        rows={4}
        maxLength={2000}
        placeholder="Steal an Egg, a description of your game, or https://www.roblox.com/games/…"
        className="min-h-96 resize-none bg-transparent px-16 py-8 text-body text-text-primary placeholder:text-text-quaternary focus:outline-none"
      />
      {attachment && (
        <div className="flex items-center gap-12 px-16 pb-8">
          <img src={attachment.dataUrl} alt={`Attached image: ${attachment.name}`} width={40} height={40} className="size-40 shrink-0 rounded-8 object-cover" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-label font-medium text-text-primary">{attachment.name}</span>
            <span className="text-caption text-text-secondary">Ask to use it as the reference for two thumbnails from it.</span>
          </div>
          <button
            type="button"
            onClick={() => onAttach(null)}
            disabled={busy}
            aria-label="Remove the attached image"
            className={buttonClasses('quiet', 'sm', 'shrink-0 pointer-coarse:min-h-48 pointer-coarse:min-w-48')}
          >
            <X className="size-16" aria-hidden="true" />
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="px-16 pb-8 text-caption text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-12 px-12 pb-12">
        <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(',')} hidden onChange={choose} />
        <Button variant="quiet" className="whitespace-nowrap" onClick={() => fileInput.current?.click()} disabled={busy}>
          <Paperclip className="size-16" aria-hidden="true" />
          {attachment ? 'Replace image' : 'Attach image'}
        </Button>
        <div className="flex items-center gap-12">
          {/* The shortcut hint shows only where the row has room beside both buttons. */}
          <span className="hidden whitespace-nowrap text-caption text-text-secondary @lg:inline" aria-hidden="true">
            <kbd className="font-sans">⌘</kbd> <kbd className="font-sans">Enter</kbd>
          </span>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="whitespace-nowrap"
            loading={busy}
            disabled={!value.trim()}
            aria-keyshortcuts="Meta+Enter Control+Enter"
          >
            {!busy && <ImagePlus className="size-16" aria-hidden="true" />}
            {attachment ? 'Make thumbnails' : 'Make 5 thumbnails'}
          </Button>
        </div>
      </div>
    </form>
  )
}
