// Gemini REST calls with key rotation: a key that answers with a billing or
// quota error is benched for a while and the next key is tried.
import { config } from './env.mjs'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const BENCH_MS = 10 * 60 * 1000
const benched = new Map()

export class ProviderUnavailable extends Error {}

function isBillingOrQuota(status, body) {
  return status === 402 || status === 429 || status === 403 || body?.error?.status === 'RESOURCE_EXHAUSTED'
}

export async function generateContent(model, request, timeoutMs = 60000) {
  const keys = config().geminiKeys
  if (keys.length === 0) throw new ProviderUnavailable('No Gemini API key: set GEMINI_API_KEY in .env.')
  const failures = []
  for (const key of keys) {
    const benchKey = `${model}:${key.slice(-6)}`
    if ((benched.get(benchKey) ?? 0) > Date.now()) {
      failures.push('benched after an earlier quota or billing error')
      continue
    }
    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs)
    })
    const body = await res.json().catch((err) => {
      console.error(`Gemini ${model} returned a non-JSON body (HTTP ${res.status}):`, err)
      return null
    })
    if (res.ok) return body
    const message = body?.error?.message?.split('\n')[0] ?? `HTTP ${res.status}`
    if (isBillingOrQuota(res.status, body)) {
      benched.set(benchKey, Date.now() + BENCH_MS)
      console.warn(`Gemini key ...${key.slice(-4)} unavailable for ${model}: ${message}`)
      failures.push(message)
      continue
    }
    throw new Error(`Gemini ${model}: ${message}`)
  }
  throw new ProviderUnavailable(`Gemini ${model} unavailable on every key: ${failures.join(' | ')}`)
}

/** Text call that must come back as JSON matching `schema`. */
export async function generateJson(systemText, userText, schema) {
  const body = await generateContent(config().textModel, {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 }
  })
  const text = body?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('')
  if (!text) throw new Error(`Gemini ${config().textModel} returned no text (finish: ${body?.candidates?.[0]?.finishReason})`)
  return JSON.parse(text)
}
