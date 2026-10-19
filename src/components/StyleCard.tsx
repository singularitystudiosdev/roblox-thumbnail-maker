import { ImageUp, RotateCcw } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import type { StyleUpload } from '../lib/api'
import { IMAGE_TYPES, readImageFile } from '../lib/files'
import { Button } from './Button'

interface StyleCardProps {
  upload: StyleUpload | null
  defaultName: string
  disabled: boolean
  onUpload: (upload: StyleUpload | null) => void
  /** Why the shown run did not use this image (a linked game or an attached image took its place), or null. */
  unusedBecause: string | null
}

export function StyleCard({ upload, defaultName, disabled, onUpload, unusedBecause }: StyleCardProps) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      onUpload(await readImageFile(file))
      setError(null)
    } catch (err) {
      console.error('Style image read failed', err)
      setError((err as Error).message)
    }
  }

  return (
    <section aria-labelledby="style-title" className="flex flex-col gap-12 rounded-16 border border-border-default bg-bg-surface p-16">
      <h2 id="style-title" className="text-title font-semibold">Your reference image</h2>
      <img
        src={upload?.dataUrl ?? '/api/style-reference'}
        alt={`Style reference: ${upload?.name ?? defaultName}`}
        width={768}
        height={432}
        className="aspect-video w-full rounded-8 object-cover"
      />
      <div className="flex flex-col gap-4">
        <span className="truncate text-body font-medium">{upload?.name ?? defaultName}</span>
        <p className="text-caption text-text-secondary">{unusedBecause ?? 'Thumbnails 1 and 5 are made in the style of this image.'}</p>
        {error && <p role="alert" className="text-caption text-destructive">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-8">
        <input ref={input} type="file" accept={IMAGE_TYPES.join(',')} hidden onChange={choose} />
        <Button onClick={() => input.current?.click()} disabled={disabled}>
          <ImageUp className="size-16" aria-hidden="true" />
          Use my own image
        </Button>
        {upload && (
          <Button variant="quiet" onClick={() => onUpload(null)} disabled={disabled}>
            <RotateCcw className="size-16" aria-hidden="true" />
            Back to default
          </Button>
        )}
      </div>
    </section>
  )
}
