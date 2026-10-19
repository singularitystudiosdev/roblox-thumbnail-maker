// fal.ai synchronous endpoint calls, shared by image generation, game sorting and judging.
import { config } from './env.mjs'
import { ProviderUnavailable } from './gemini.mjs'

/** A failure worth another try: fal refused the stream under load, or answered 429 or a 5xx. */
export class TransientFalError extends Error {}

// fal answers a burst of big requests by refusing the HTTP/2 stream (NGHTTP2_ENHANCE_YOUR_CALM,
// surfacing as "fetch failed"); a short pause clears it. A timeout is not retried: it already took minutes.
export const RETRY_PAUSES_MS = [1500, 4000]
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504])
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms > 0 ? ms + Math.random() * 500 : 0))

async function falOnce(endpoint, input, key, timeoutMs) {
  let res
  try {
    res = await fetch(`https://fal.run/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw err
    throw new TransientFalError(`fal ${endpoint}: ${err.message}${err.cause?.code ? ` (${err.cause.code})` : ''}`, { cause: err })
  }
  const body = await res.json().catch((err) => {
    console.error(`fal ${endpoint} returned a non-JSON body (HTTP ${res.status}):`, err)
    return null
  })
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail ?? body)
    const message = `fal ${endpoint}: HTTP ${res.status} ${detail}`
    throw TRANSIENT_STATUS.has(res.status) ? new TransientFalError(message) : new Error(message)
  }
  return body
}

/** One fal call, retried after RETRY_PAUSES_MS on a transient failure. */
export async function falRun(endpoint, input, timeoutMs = 240000, { retryPauses = RETRY_PAUSES_MS } = {}) {
  const [key] = config().falKeys
  if (!key) throw new ProviderUnavailable('No fal.ai key: set FAL_KEY in .env.')
  for (let attempt = 0; ; attempt++) {
    try {
      return await falOnce(endpoint, input, key, timeoutMs)
    } catch (err) {
      if (!(err instanceof TransientFalError) || attempt >= retryPauses.length) throw err
      console.warn(`${err.message}; retry ${attempt + 1} of ${retryPauses.length}.`)
      await pause(retryPauses[attempt])
    }
  }
}
