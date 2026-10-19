import assert from 'node:assert/strict'
import { test } from 'node:test'
import { judgeRoutes, parseJsonReply, textRoutes } from './llm.mjs'

test('a reply parses to its first JSON object, past fences, prose and a restated second object', () => {
  assert.deepEqual(parseJsonReply('```json\n{"thumbnail": 2, "why": "a {clean} one"}\n```'), { thumbnail: 2, why: 'a {clean} one' })
  assert.deepEqual(parseJsonReply('{"thumbnail": 2, "nested": {"a": 1}}\n\n{"thumbnail": 3}'), { thumbnail: 2, nested: { a: 1 } })
  assert.deepEqual(parseJsonReply('Pick {one}: {"thumbnail": 1}'), { thumbnail: 1 })
  assert.throws(() => parseJsonReply('no object here'), /No JSON object/)
})

test('the checked fal.ai Claude models answer first; Gemini is only the fallback', () => {
  const judge = judgeRoutes()
  assert.deepEqual(judge[0], { provider: 'fal', model: 'anthropic/claude-sonnet-5.5', reasoning: true })
  assert.ok(judge.slice(1).every((route) => route.provider === 'gemini'))
  const text = textRoutes()
  assert.deepEqual(text[0], { provider: 'fal', model: 'anthropic/claude-haiku-5.5' })
  assert.ok(text.slice(1).every((route) => route.provider === 'gemini'))
})
