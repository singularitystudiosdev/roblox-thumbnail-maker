// Small structured asks of a text or vision model, answered as JSON: each
// route is tried in order (Gemini with its key rotation, then fal.ai's
// OpenRouter router), the first usable answer wins.
import { config } from './env.mjs'
import { falRun } from './fal.mjs'
import { generateContent } from './gemini.mjs'

/** Where the object opening at `start` closes (its braces balanced, strings skipped), or -1. */
function objectEnd(reply, start) {
  let depth = 0
  let inString = false
  for (let i = start; i < reply.length; i++) {
    const ch = reply[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

/**
 * The first JSON object in a model reply, tolerating ```json fences, prose around it and a second
 * object after it (Claude sometimes restates its answer).
 */
export function parseJsonReply(text) {
  const reply = String(text ?? '')
  let lastError = null
  for (let start = reply.indexOf('{'); start >= 0; start = reply.indexOf('{', start + 1)) {
    const end = objectEnd(reply, start)
    if (end < 0) break
    try {
      return JSON.parse(reply.slice(start, end + 1))
    } catch (err) {
      lastError = err
    }
  }
  throw new Error(`No JSON object in the model reply: ${reply.slice(0, 200)}`, { cause: lastError ?? undefined })
}

/** Text a person reads: no dashes as punctuation, whatever the model wrote. */
export const withoutDashes = (value) =>
  String(value ?? '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+--?\s+/g, ', ')
    .trim()

const dataUrl = (image) => `data:${image.mimeType};base64,${image.bytes.toString('base64')}`

async function viaGemini(model, { system, user, images, schema }) {
  const parts = [{ text: user }]
  for (const image of images) {
    if (image.label) parts.push({ text: `${image.label}:` })
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.bytes.toString('base64') } })
  }
  const body = await generateContent(
    model,
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}) }
    },
    120000
  )
  const text = body?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('')
  if (!text) throw new Error(`Gemini ${model} returned no text (finish: ${body?.candidates?.[0]?.finishReason ?? 'unknown'})`)
  return parseJsonReply(text)
}

// fal's vision router refuses Claude Sonnet without reasoning ("Reasoning is mandatory for this endpoint").
async function viaFal({ model, reasoning = false }, { system, user, images }) {
  const vision = images.length > 0
  const order = vision ? `\n\nThe images are attached in this order: ${images.map((img, i) => img.label ?? `image ${i + 1}`).join(', ')}.` : ''
  const body = await falRun(
    vision ? 'openrouter/router/vision' : 'openrouter/router',
    {
      model,
      system_prompt: system,
      prompt: `${user}${order}\n\nReply with the JSON object only.`,
      max_tokens: reasoning ? 8000 : 1500,
      ...(reasoning ? { reasoning: true } : { temperature: 0 }),
      // An image fal already hosts goes by its link; anything else as a data URL.
      ...(vision ? { image_urls: images.map((img) => img.url ?? dataUrl(img)) } : {})
    },
    180000
  )
  return parseJsonReply(body?.output)
}

/**
 * `request`: { label, system, user, images?: [{ label?, mimeType, bytes, url? }], schema? }; `url` is
 * a public link fal can fetch instead of the bytes (Gemini always gets the bytes).
 * `routes`: [{ provider: 'gemini' | 'fal', model, reasoning? }]. Returns { value, provider, model }.
 */
export async function askJson(request, routes) {
  const ask = { images: [], ...request }
  const failures = []
  for (const route of routes) {
    try {
      const value = route.provider === 'gemini' ? await viaGemini(route.model, ask) : await viaFal(route, ask)
      return { value, provider: route.provider, model: route.model }
    } catch (err) {
      console.error(`${ask.label} via ${route.provider} ${route.model} failed:`, err)
      failures.push(`${route.model}: ${err.message}`)
    }
  }
  throw new Error(`${ask.label} failed on every model: ${failures.join(' | ')}`)
}

// fal.ai first: every judge verdict, kind sort and search pick checked against the creator's own
// picks ran on fal's Claude models. Gemini is the fallback, so topping up its credit does not
// silently move them to a model nobody has checked.
export const textRoutes = () => [
  { provider: 'fal', model: config().falTextModel },
  { provider: 'gemini', model: config().textModel }
]

export const judgeRoutes = () => [
  { provider: 'fal', model: config().falJudgeModel, reasoning: true },
  ...config().judgeModels.map((model) => ({ provider: 'gemini', model }))
]
