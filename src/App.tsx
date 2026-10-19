import { Banana, Download, RefreshCw, Scale, Trophy } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { buttonClasses, Button } from './components/Button'
import { HistoryList } from './components/HistoryList'
import { PromptBox } from './components/PromptBox'
import { ReferenceCard } from './components/ReferenceCard'
import { StyleCard } from './components/StyleCard'
import { ThumbnailGrid } from './components/ThumbnailGrid'
import { WinnerStage, type Phase } from './components/WinnerStage'
import { api, slugify, strategyLabel, type Run, type RunEvent, type Status, type StyleUpload, type Thumbnail } from './lib/api'

const EXAMPLES = [
  'https://www.roblox.com/games/107778070777162/Steal-An-Egg',
  'A axe throwing game with a bacon hair in the thumbnail',
  'Rob a Bank'
]

function useElapsed(running: boolean) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!running) return
    const started = Date.now()
    setElapsed(0)
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [running])
  return elapsed
}

/** "Picked in 2 of 3 judge passes. " when the judge ran several passes; the winner is their pick, not the top score. */
function votesLine(run: Run) {
  const { votes, passes, winnerSlot } = run.judge ?? {}
  if (!votes || !passes || passes.length < 2 || winnerSlot == null) return ''
  return `Picked in ${votes[winnerSlot] ?? 0} of ${passes.length} judge passes. `
}

/** The run with one streamed event folded in. */
function applyEvent(run: Run | null, event: RunEvent): Run | null {
  if (event.type === 'plan' || event.type === 'done') return event.run
  if (!run) return run
  if (event.type === 'reference') return { ...run, reference: event.reference }
  if (event.type === 'searchReference') return { ...run, searchReference: event.searchReference }
  if (event.type === 'thumbnail') return { ...run, thumbnails: [...run.thumbnails.filter((t) => t.slot !== event.thumbnail.slot), event.thumbnail] }
  if (event.type === 'icon') {
    const withIcon = (t: Thumbnail) => (t.slot === event.slot ? { ...t, iconUrl: event.iconUrl, iconRedrawn: event.iconRedrawn } : t)
    return { ...run, thumbnails: run.thumbnails.map(withIcon) }
  }
  if (event.type === 'judge') return { ...run, judge: event.judge, winnerSlot: event.judge.winnerSlot }
  return run
}

export function App() {
  const [prompt, setPrompt] = useState('')
  const [styleUpload, setStyleUpload] = useState<StyleUpload | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [shownSlot, setShownSlot] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Run[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const exampleIndex = useRef(0)
  const busy = phase === 'running' || phase === 'judging'
  const elapsed = useElapsed(busy)

  const refreshHistory = useCallback(() => {
    api.runs().then((r) => setHistory(r.items)).catch((err) => console.error('History load failed', err))
  }, [])

  useEffect(() => {
    refreshHistory()
    api.status().then(setStatus).catch((err) => console.error('Status load failed', err))
  }, [refreshHistory])
  const start = async (text = prompt) => {
    if (!text.trim()) return
    setPhase('running')
    setError(null)
    setRun(null)
    setShownSlot(null)
    let finished = false
    try {
      await api.run(text, styleUpload, (event) => {
        if (event.type === 'error') throw new Error(event.error)
        if (event.type === 'judging') setPhase('judging')
        if (event.type === 'done') finished = true
        setRun((current) => applyEvent(current, event))
      })
      if (!finished) throw new Error('The run stopped before it finished. Check the server terminal.')
      setPhase('done')
      refreshHistory()
    } catch (err) {
      console.error('Run failed', err)
      setError((err as Error).message)
      setPhase('error')
    }
  }

  const tryExample = () => {
    const text = EXAMPLES[exampleIndex.current++ % EXAMPLES.length]
    setPrompt(text)
    void start(text)
  }

  const openHistory = (item: Run) => {
    setRun(item)
    setPrompt(item.input)
    setShownSlot(null)
    setError(null)
    setPhase('done')
  }

  // The same thumbnails, judged again by the current judge; the new verdict is saved with the run.
  const judgeAgain = async (id: string) => {
    setPhase('judging')
    setError(null)
    try {
      setRun(await api.rejudge(id))
      setShownSlot(null)
      setPhase('done')
      refreshHistory()
    } catch (err) {
      console.error('Judging again failed', err)
      setError((err as Error).message)
      setPhase('error')
    }
  }

  const winnerSlot = run?.judge?.winnerSlot ?? null
  const firstImage = run?.thumbnails.filter((t) => t.imageUrl).sort((a, b) => a.slot - b.slot)[0]?.slot ?? null
  const stageSlot = shownSlot ?? winnerSlot ?? firstImage
  const winner = run?.thumbnails.find((t) => t.slot === winnerSlot && t.imageUrl)
  const route = status ? (status.imageProvider === 'fal' ? 'fal.ai' : status.falKeys > 0 ? 'Gemini API, fal.ai fallback' : 'Gemini API') : null

  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-12 border-b border-border-default px-24 py-12">
        <div className="flex items-center gap-12">
          <span className="grid size-32 place-items-center rounded-8 bg-brand text-on-brand">
            <Banana className="size-20" aria-hidden="true" />
          </span>
          <h1 className="font-display text-title font-bold">Roblox Thumbnail Maker</h1>
        </div>
        {route && (
          <p className="text-caption text-text-secondary">
            {status?.imageModelLabel} via {route}
          </p>
        )}
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-24 px-16 py-24 sm:px-24 lg:grid-cols-12 lg:px-32">
        {/* Phones: the left column dissolves so the results sit right under the prompt. */}
        <div className="contents lg:col-span-4 lg:flex lg:min-w-0 lg:flex-col lg:gap-24">
          <div className="order-1 min-w-0 lg:order-none">
            <PromptBox value={prompt} onChange={setPrompt} onSubmit={() => start()} busy={busy} />
          </div>
          <div className="order-3 min-w-0 lg:order-none">
            <StyleCard upload={styleUpload} defaultName={status?.styleReferenceName ?? 'Default reference'} disabled={busy} onUpload={setStyleUpload} />
          </div>
          <div className="order-4 min-w-0 lg:order-none">
            <ReferenceCard reference={run?.reference ?? null} searchReference={run?.searchReference ?? null} loading={busy && !run?.reference} />
          </div>
        </div>

        <div className="contents lg:col-span-8 lg:flex lg:min-w-0 lg:flex-col lg:gap-24">
          <div className="order-2 flex min-w-0 flex-col gap-16 lg:order-none">
            <WinnerStage phase={phase} run={run} shownSlot={stageSlot} elapsed={elapsed} error={error} onExample={tryExample} onRetry={() => start()} />
            {run && !busy && (
              <div className="flex flex-wrap items-start justify-between gap-16">
                <div className="flex min-w-0 max-w-prose flex-col gap-4">
                  <h2 className="font-display text-display font-bold">{run.gameName}</h2>
                  <p className="text-caption text-text-secondary">
                    {run.namedBy === 'link' ? 'Game name read from your Roblox link.' : 'Game name exactly as you wrote it.'}
                  </p>
                  {winner && run.judge?.reason && (
                    <p className="flex items-start gap-8 text-label text-text-primary">
                      <Trophy className="mt-2 size-16 shrink-0 text-brand" aria-hidden="true" />
                      <span>
                        Thumbnail {winner.slot} ({strategyLabel(winner)}) wins. {votesLine(run)}
                        {run.judge.reason}
                      </span>
                    </p>
                  )}
                  {run.judge?.error && <p role="alert" className="text-label text-destructive">The judge could not pick a winner: {run.judge.error}</p>}
                  {phase === 'error' && error && <p role="alert" className="text-label text-destructive">{error}</p>}
                </div>
                <div className="flex flex-wrap gap-8">
                  {winner?.imageUrl && (
                    <a href={winner.imageUrl} download={`${slugify(run.gameName)}-winner.png`} className={buttonClasses('normal', 'md')}>
                      <Download className="size-16" aria-hidden="true" />
                      Download winner
                    </a>
                  )}
                  {winner?.iconUrl && (
                    <a href={winner.iconUrl} download={`${slugify(run.gameName)}-winner-icon.png`} className={buttonClasses('normal', 'md')}>
                      <Download className="size-16" aria-hidden="true" />
                      Download icon
                    </a>
                  )}
                  {run.thumbnails.filter((t) => t.imageUrl).length > 1 && (
                    <Button onClick={() => judgeAgain(run.id)}>
                      <Scale className="size-16" aria-hidden="true" />
                      Judge again
                    </Button>
                  )}
                  <Button onClick={() => start(prompt || run.input)}>
                    <RefreshCw className="size-16" aria-hidden="true" />
                    Make 5 more
                  </Button>
                </div>
              </div>
            )}
          </div>

          {run && (
            <div className="order-2 min-w-0 lg:order-none">
              <ThumbnailGrid run={run} busy={busy} shownSlot={stageSlot} onShow={setShownSlot} />
            </div>
          )}
          <div className="order-5 min-w-0 lg:order-none">
            <HistoryList items={history} currentId={run?.id ?? null} onOpen={openHistory} />
          </div>
        </div>
      </main>
    </div>
  )
}
