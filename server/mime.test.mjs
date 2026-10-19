import assert from 'node:assert/strict'
import { test } from 'node:test'
import { imageMimeType } from './mime.mjs'

const pad = (head) => Buffer.concat([Buffer.from(head), Buffer.alloc(16)])

test('the bytes decide the type, not the loose header Roblox sends', () => {
  assert.equal(imageMimeType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/Png'), 'image/png')
  assert.equal(imageMimeType(pad([0xff, 0xd8, 0xff, 0xe0]), 'application/octet-stream'), 'image/jpeg')
  assert.equal(imageMimeType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]), null), 'image/webp')
})

test('unknown bytes fall back to the header lowercased, then PNG', () => {
  assert.equal(imageMimeType(pad([1, 2, 3]), 'image/AVIF; q=1'), 'image/avif')
  assert.equal(imageMimeType(Buffer.from('x'), undefined), 'image/png')
})
