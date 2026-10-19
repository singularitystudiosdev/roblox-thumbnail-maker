// fal.ai synchronous endpoint calls, shared by image generation and game naming.
import { config } from './env.mjs'
import { ProviderUnavailable } from './gemini.mjs'

export async function falRun(endpoint, input, timeoutMs = 240000) {
  const [key] = config().falKeys
  if (!key) throw new ProviderUnavailable('No fal.ai key: set FAL_KEY in .env.')
  const res = await fetch(`https://fal.run/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs)
  })
  const body = await res.json().catch((err) => {
    console.error(`fal ${endpoint} returned a non-JSON body (HTTP ${res.status}):`, err)
    return null
  })
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail ?? body)
    throw new Error(`fal ${endpoint}: HTTP ${res.status} ${detail}`)
  }
  return body
}
