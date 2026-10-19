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

test('every image is Nano Banana Pro: gemini-3-pro-image, then fal-ai/nano-banana-pro/edit', () => {
  assert.deepEqual(modelIn({}).model, { key: 'nano-banana-pro', label: 'Nano Banana Pro', gemini: 'gemini-3-pro-image', fal: 'fal-ai/nano-banana-pro/edit' })
})

test('GEMINI_IMAGE_MODEL and FAL_IMAGE_MODEL still override the ids', () => {
  const { model } = modelIn({ GEMINI_IMAGE_MODEL: 'gemini-x', FAL_IMAGE_MODEL: 'fal-ai/x/edit' })
  assert.equal(model.gemini, 'gemini-x')
  assert.equal(model.fal, 'fal-ai/x/edit')
  assert.equal(model.label, 'Nano Banana Pro')
})

test('runs and the page name the one model the same way; no Nano Banana 2 id remains', () => {
  const { model, label } = modelIn({})
  assert.equal(label, model.label)
  assert.ok(!JSON.stringify(model).includes('nano-banana-2'))
  assert.ok(!JSON.stringify(model).includes('3.1-flash'))
})
