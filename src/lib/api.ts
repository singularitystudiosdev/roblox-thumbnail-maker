export interface Plan {
  gameName: string
  prompt: string
}

export interface Generation {
  id: string
  createdAt: string
  imageUrl: string
  gameName: string
  prompt: string
  resolution: string
  reference: { name: string }
  provider: 'gemini' | 'fal'
  model: string
  ms: number
}

export interface Status {
  geminiKeys: number
  falKeys: number
  imageProvider: string
  imageModel: string
  falModel: string
  referenceName: string
  referenceUrl: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const body = await res.json().catch((err) => {
    console.error(`${path} returned a non-JSON body`, err)
    return null
  })
  if (!res.ok) throw new Error(body?.error ?? `Request failed with HTTP ${res.status}. Check the server terminal.`)
  return body as T
}

export const api = {
  plan: (prompt: string) => request<Plan>('/api/plan', { method: 'POST', body: JSON.stringify({ prompt }) }),
  generate: (input: { gameName: string }) =>
    request<Generation>('/api/generate', { method: 'POST', body: JSON.stringify(input) }),
  history: () => request<{ items: Generation[] }>('/api/history'),
  status: () => request<Status>('/api/status')
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
export function formatAgo(iso: string) {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]]
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  return 'just now'
}

export const providerLabel = (provider: Generation['provider']) => (provider === 'gemini' ? 'Gemini API' : 'fal.ai')

/** Older saved results came from Nano Banana Pro; everything new is Nano Banana 2. */
export const modelLabel = (model: string) => (/pro/i.test(model) ? 'Nano Banana Pro' : 'Nano Banana 2')
