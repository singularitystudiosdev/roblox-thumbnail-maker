import { formatAgo, modelLabel, type Generation } from '../lib/api'

interface HistoryListProps {
  items: Generation[]
  currentId: string | null
  onOpen: (item: Generation) => void
}

export function HistoryList({ items, currentId, onOpen }: HistoryListProps) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-8 rounded-16 border border-border-default bg-bg-surface p-16">
      <h2 id="history-title" className="text-title font-semibold">Earlier thumbnails</h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item)}
              aria-current={item.id === currentId || undefined}
              className="focus-ring flex w-full items-center gap-12 rounded-8 p-8 text-left transition-colors duration-100 hover:bg-bg-canvas aria-[current=true]:bg-bg-canvas"
            >
              <img src={item.imageUrl} alt="" width={128} height={72} loading="lazy" className="h-72 w-128 shrink-0 rounded-8 object-cover" />
              <span className="flex min-w-0 flex-col gap-2">
                <span className="truncate text-label font-medium">{item.gameName}</span>
                <span className="truncate text-caption text-text-secondary">Styled after {item.reference.name}</span>
                <span className="flex gap-8 text-caption text-text-secondary">
                  <time dateTime={item.createdAt}>{formatAgo(item.createdAt)}</time>
                  <span>{modelLabel(item.model)}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
