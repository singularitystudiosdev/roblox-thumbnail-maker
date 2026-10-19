import { armLabel, formatAgo, type Run } from '../lib/api'

interface HistoryListProps {
  items: Run[]
  currentId: string | null
  onOpen: (item: Run) => void
}

const coverOf = (run: Run) => {
  const winner = run.userPick?.slot ?? run.winnerSlot
  return run.thumbnails.find((t) => t.slot === winner && t.imageUrl)?.imageUrl ?? run.thumbnails.find((t) => t.imageUrl)?.imageUrl
}

export function HistoryList({ items, currentId, onOpen }: HistoryListProps) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-8 rounded-16 border border-border-default bg-bg-surface p-16">
      <h2 id="history-title" className="text-title font-semibold">
        Earlier runs <span className="font-normal text-text-secondary">{items.length}</span>
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item)}
              aria-current={item.id === currentId || undefined}
              className="focus-ring flex w-full items-center gap-12 rounded-8 p-8 text-left transition-colors duration-100 hover:bg-bg-canvas aria-[current=true]:bg-bg-canvas"
            >
              {coverOf(item) ? (
                <img src={coverOf(item)} alt="" width={128} height={72} loading="lazy" className="h-72 w-128 shrink-0 rounded-8 object-cover" />
              ) : (
                <span className="h-72 w-128 shrink-0 rounded-8 bg-bg-canvas" />
              )}
              <span className="flex min-w-0 flex-col gap-2">
                <span className="truncate text-label font-medium">{item.gameName}</span>
                <span className="truncate text-caption text-text-secondary">
                  {item.userPick
                    ? `Your pick: thumbnail ${item.userPick.slot}`
                    : item.winnerSlot
                      ? `Winner: thumbnail ${item.winnerSlot}`
                      : 'No winner picked'}
                  {item.selection && !item.selection.explore
                    ? `, ${armLabel(item.selection.arm)}`
                    : item.reference?.source === 'roblox'
                      ? `, remixed from ${item.reference.name}`
                      : ''}
                </span>
                <time dateTime={item.createdAt} className="text-caption text-text-secondary">
                  {formatAgo(item.createdAt)}
                </time>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
