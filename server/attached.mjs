// The attached-reference mode. When the creator attaches an image in the
// prompt box and their prompt uses it (says to use it as the reference, or
// talks about what is in it: "make him have a gun"), a run makes the meta (the
// plain template with the nearest popular Roblox game's thumbnail, as every
// run does) and then their prompt exactly as typed, sent with that image. A
// text model reads the intent and hands back the prompt with only the words
// about the image removed, word for word, to name the game. An attached image
// the prompt does not ask for is not used.
import { askJson, textRoutes } from './llm.mjs'
import { buildPrompt, PLAIN_TEMPLATE } from './prompt.mjs'

export const INTENT_SYSTEM = `You read what a creator typed when asking for a Roblox game thumbnail, with an image attached.
- useAsReference: true when the text uses the attached image in any way: it says to use it as the reference, base, style or starting point ("use this as reference", "in the style of this image", "like the attached picture"), or it talks about what is in the image or asks for a change to it, so it only makes sense with the image ("make him have a gun", "give her a sword", "make it night time", "add a dragon behind them"). False only when the text never refers to the image: a game name or description that stands on its own.
- gameText: the creator's text with only the words about the attached image removed. Keep every other word exactly as typed: the same words, order, spelling and capitals. When no words are about the image, the whole text.
Reply as JSON: {"useAsReference": true, "gameText": "..."}`

const INTENT_SCHEMA = {
  type: 'OBJECT',
  properties: { useAsReference: { type: 'BOOLEAN' }, gameText: { type: 'STRING' } },
  required: ['useAsReference', 'gameText']
}

// Without a model: naming the image or a reference, or a person in it ("make him have a gun"), counts as asking for it.
const REFERENCE_WORDS = /\b(reference|ref)\b|\b(this|my|the|attached)\s+(image|picture|pic|photo|screenshot)\b|\battached\b|\b(him|her|he|she|his|them|they)\b/i

// The removed words must be about the image, or the model shortened the game itself.
const IMAGE_WORD = /\b(image|picture|pic|photo|screenshot|reference|ref|attached|attachment)\b/

const words = (text) => String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/**
 * True when `part` is `whole` with one run of words about the image taken out
 * and nothing else changed, or `whole` itself. "Axe Throwing" from "A axe
 * throwing game with a bacon hair ... in the style of my image" is refused:
 * it drops words that describe the game.
 */
export function removesOnlyImageWords(part, whole) {
  const a = words(whole)
  const b = words(part)
  if (b.length === a.length) return b.every((w, i) => w === a[i])
  if (b.length === 0 || b.length > a.length) return false
  let prefix = 0
  while (prefix < b.length && a[prefix] === b[prefix]) prefix++
  for (let p = prefix; p >= 0; p--) {
    const tail = b.length - p
    if (b.slice(p).every((w, i) => w === a[a.length - tail + i])) return IMAGE_WORD.test(a.slice(p, a.length - tail).join(' '))
  }
  return false
}

/**
 * Whether the prompt asks to use the attached image as the reference, and the
 * prompt without the words about the image (the whole prompt when the model
 * changed anything else). `ask` is swappable in tests.
 */
export async function readAttachedIntent(prompt, { ask = askJson } = {}) {
  try {
    const { value, model } = await ask({ label: 'Attached image intent', system: INTENT_SYSTEM, user: prompt, schema: INTENT_SCHEMA }, textRoutes())
    const text = typeof value.gameText === 'string' ? value.gameText.trim() : ''
    const gameText = text && removesOnlyImageWords(text, prompt) ? text : prompt
    return { useAsReference: value.useAsReference === true, gameText, readBy: model }
  } catch (err) {
    console.error('Reading whether to use the attached image failed; matching reference words instead:', err)
    return { useAsReference: REFERENCE_WORDS.test(prompt), gameText: prompt, readBy: 'reference words' }
  }
}

/** The two thumbnails of an attached-reference run: the meta on the Roblox reference, then the prompt as typed with the attached image. */
export function planAttachedSlots(prompt, gameName) {
  return [
    { slot: 1, strategy: 'meta', prompt: buildPrompt(gameName, PLAIN_TEMPLATE) },
    { slot: 2, strategy: 'typed', prompt }
  ]
}
