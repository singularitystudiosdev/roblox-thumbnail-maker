import assert from 'node:assert/strict'
import { test } from 'node:test'
import { judgeRoutes, textRoutes } from './llm.mjs'

test('the checked fal.ai Claude models answer first; Gemini is only the fallback', () => {
  const judge = judgeRoutes()
  assert.deepEqual(judge[0], { provider: 'fal', model: 'anthropic/claude-sonnet-5.5', reasoning: true })
  assert.ok(judge.slice(1).every((route) => route.provider === 'gemini'))
  const text = textRoutes()
  assert.deepEqual(text[0], { provider: 'fal', model: 'anthropic/claude-haiku-5.5' })
  assert.ok(text.slice(1).every((route) => route.provider === 'gemini'))
})
