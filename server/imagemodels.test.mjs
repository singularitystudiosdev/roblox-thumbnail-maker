import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const MODULE = fileURLToPath(new URL('./imagemodels.mjs', import.meta.url))

// config() reads the environment once per process, as the server does at start,
// so each case asks a fresh process with exactly the image model variables given.
function modelIn(env) {
  const base = { ...process.env }
  delete base.GEMINI_IMAGE_MODEL
  delete base.FAL_IMAGE_MODEL
  const script = `const m = await import(${JSON.stringify(MODULE)}); console.log(JSON.stringify({ model: m.imageModel(), label: m.IMAGE_MODEL_LABEL }))`
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...base, ...env }, encoding: 'utf8' })
  return JSON.parse(out.trim().split('\n').at(-1))
}

test('every image is Nano Banana 2.1 on fal.ai, with no Gemini API id', () => {
  assert.deepEqual(modelIn({}).model, { key: 'nano-banana-2.1', label: 'Nano Banana 2.1', gemini: null, fal: 'google/nano-banana-2.1/edit' })
})

test('GEMINI_IMAGE_MODEL and FAL_IMAGE_MODEL still override the ids', () => {
  const { model } = modelIn({ GEMINI_IMAGE_MODEL: 'gemini-x', FAL_IMAGE_MODEL: 'fal-ai/x/edit' })
  assert.equal(model.gemini, 'gemini-x')
  assert.equal(model.fal, 'fal-ai/x/edit')
  assert.equal(model.label, 'Nano Banana 2.1')
})

test('runs and the page name the one model the same way; no Nano Banana Pro id remains', () => {
  const { model, label } = modelIn({})
  assert.equal(label, model.label)
  assert.ok(!JSON.stringify(model).includes('pro'))
})
