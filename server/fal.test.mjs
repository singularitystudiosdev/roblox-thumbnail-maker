import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

// A key in the environment, so config() never needs the keychain here.
process.env.FAL_KEY = 'test-key'
const { falRun, TransientFalError } = await import('./fal.mjs')

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Answers each call with the next outcome: an Error to throw, or [status, body]. */
function stubFetch(outcomes) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    const next = outcomes.shift()
    if (next instanceof Error) throw next
    return new Response(JSON.stringify(next[1]), { status: next[0], headers: { 'Content-Type': 'application/json' } })
  }
  return calls
}

const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ERR_HTTP2_STREAM_ERROR' } })

test('a refused stream or a 429 is retried until fal answers', async () => {
  const calls = stubFetch([refused(), [429, { detail: 'slow down' }], [200, { output: 'ok' }]])
  const body = await falRun('openrouter/router/vision', { prompt: 'p' }, 1000, { retryPauses: [0, 0] })
  assert.deepEqual(body, { output: 'ok' })
  assert.equal(calls.length, 3)
  assert.ok(calls.every((c) => c.url === 'https://fal.run/openrouter/router/vision' && c.body.prompt === 'p'))
})

test('retries stop after the last pause, with the transient error', async () => {
  stubFetch([refused(), refused(), refused()])
  await assert.rejects(falRun('x', {}, 1000, { retryPauses: [0, 0] }), (err) => err instanceof TransientFalError && /ERR_HTTP2_STREAM_ERROR/.test(err.message))
})

test("a request fal rejects for its own fault is not retried", async () => {
  const calls = stubFetch([[400, { detail: 'Reasoning is mandatory for this endpoint' }], [200, { output: 'never' }]])
  await assert.rejects(falRun('x', {}, 1000, { retryPauses: [0, 0] }), /HTTP 400 Reasoning is mandatory/)
  assert.equal(calls.length, 1)
})
