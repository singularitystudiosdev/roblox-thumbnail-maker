import { Banana, Download, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { buttonClasses, Button } from './components/Button'
import { HistoryList } from './components/HistoryList'
import { PromptBox } from './components/PromptBox'
import { PromptPanel } from './components/PromptPanel'
import { ReferenceCard } from './components/ReferenceCard'
import { ResultStage, type Phase } from './components/ResultStage'
import { api, modelLabel, providerLabel, type Generation, type Status } from './lib/api'

const EXAMPLES = ['Rob a Bank', 'Make me a roblox thumbnail for my game Lava Leap', 'Grow a Garden']
const MODEL_NAME = 'Nano Banana 2'

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

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'thumbnail'
}

export function App() {
  const [prompt, setPrompt] = useState('')
  const [gameName, setGameName] = useState('')
  const [result, setResult] = useState<Generation | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Generation[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const exampleIndex = useRef(0)
  const busy = phase === 'planning' || phase === 'generating'
  const elapsed = useElapsed(busy)

  const refreshHistory = useCallback(() => {
    api.history().then((r) => setHistory(r.items)).catch((err) => console.error('History load failed', err))
  }, [])

  useEffect(() => {
    refreshHistory()
    api.status().then(setStatus).catch((err) => console.error('Status load failed', err))
  }, [refreshHistory])

  const generate = async (name: string) => {
    setPhase('generating')
    setError(null)
    try {
      const generation = await api.generate({ gameName: name })
      setResult(generation)
      setPhase('done')
      refreshHistory()
    } catch (err) {
      console.error('Generation failed', err)
      setError((err as Error).message)
      setPhase('error')
    }
  }

  const run = async (text = prompt) => {
    setPhase('planning')
    setError(null)
    try {
      const plan = await api.plan(text)
      setGameName(plan.gameName)
      await generate(plan.gameName)
    } catch (err) {
      console.error('Naming failed', err)
      setError((err as Error).message)
      setPhase('error')
    }
  }

  const tryExample = () => {
    const text = EXAMPLES[exampleIndex.current++ % EXAMPLES.length]
    setPrompt(text)
    void run(text)
  }

  const retry = () => (gameName.trim() ? generate(gameName) : run())

  const openHistory = (item: Generation) => {
    setResult(item)
    setGameName(item.gameName)
    setPhase('done')
  }

  const changed = result && result.gameName !== gameName.trim()
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
        {route && <p className="text-caption text-text-secondary">{MODEL_NAME} via {route}</p>}
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-24 px-16 py-24 sm:px-24 lg:grid-cols-12 lg:px-32">
        <div className="flex min-w-0 flex-col gap-24 lg:col-span-4">
          <PromptBox value={prompt} onChange={setPrompt} onSubmit={() => run()} busy={busy} />
          {status && <ReferenceCard name={status.referenceName} url={status.referenceUrl} />}
        </div>

        <div className="flex min-w-0 flex-col gap-24 lg:col-span-8">
          <div className="flex flex-col gap-16">
            <ResultStage
              phase={phase}
              result={result}
              gameName={gameName}
              modelName={MODEL_NAME}
              elapsed={elapsed}
              error={error}
              onExample={tryExample}
              onRetry={retry}
            />
            {result && !busy && (
              <div className="flex flex-wrap items-end justify-between gap-16">
                <div className="flex min-w-0 flex-col gap-4">
                  <h2 className="font-display text-display font-bold">{result.gameName}</h2>
                  <p className="flex flex-wrap gap-12 text-caption text-text-secondary">
                    <span>{modelLabel(result.model)} on {providerLabel(result.provider)}</span>
                    <span>{result.resolution}</span>
                    <span>{Math.round(result.ms / 1000)}s</span>
                  </p>
                </div>
                <div className="flex gap-8">
                  <a href={result.imageUrl} download={`${slugify(result.gameName)}-thumbnail.png`} className={buttonClasses('normal', 'md')}>
                    <Download className="size-16" aria-hidden="true" />
                    Download
                  </a>
                  <Button onClick={retry} disabled={!gameName.trim()}>
                    <RefreshCw className="size-16" aria-hidden="true" />
                    {changed ? 'Generate with new name' : 'Regenerate'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {(gameName || result) && phase !== 'planning' && (
            <PromptPanel modelName={MODEL_NAME} gameName={gameName} onGameName={setGameName} />
          )}
          <HistoryList items={history} currentId={result?.id ?? null} onOpen={openHistory} />
        </div>
      </main>
    </div>
  )
}
