// The prompts the image model receives, word for word. Thumbnail 1 is the
// template with only GAME_NAME substituted; thumbnails 2 and 3 are two
// different remix prompts drawn at random, each sent with a Roblox reference.
export const PROMPT_TEMPLATE =
  'Make me a thumbnail for my game GAME_NAME in the style of my reference image different characters. No text. 16:9 Ratio.'

export const REMIX_PROMPTS = [
  'Make this thumbnail but Before-and-After. No text.',
  'Make this thumbnail but from a novel perspective. No text.',
  'Make this thumbnail but High Angle. No text.',
  'Make this thumbnail but Profile Shot. No text.'
]

export const stripQuotes = (value) => value.trim().replace(/^["“”']+|["“”']+$/g, '').trim()

export function buildPrompt(gameName) {
  const name = String(gameName ?? '').trim()
  if (!name) throw new Error('A game name is required to build the prompt.')
  // A function replacement, so "$&" or "$1" in a name is inserted literally.
  return PROMPT_TEMPLATE.replace('GAME_NAME', () => name)
}

/** Two different remix prompts, each pick uniform over what is left. */
export function pickRemixPrompts(random = Math.random) {
  const pool = [...REMIX_PROMPTS]
  const first = pool.splice(Math.floor(random() * pool.length), 1)[0]
  const second = pool[Math.floor(random() * pool.length)]
  return [first, second]
}

// Double quotes only: an apostrophe ("Grandma's House") is part of a name, not a quote.
const QUOTED_NAME = /["“”]([^"“”]+)["“”]/
// "Make me a roblox thumbnail for", "can you create a thumbnail for", "thumbnail for"
const REQUEST_PREFIX =
  /^(?:(?:please|pls|can you|could you)\s+)*(?:(?:make|create|generate|design|draw|do|give)\s+(?:me\s+)?)?(?:an?\s+)?(?:(?:roblox|youtube|game|new)\s+)*thumbnails?\s+(?:for|of)\s+/i
// "my game", "the roblox game", "my game is called", "a game called"; never a bare "a game where ..."
const GAME_PREFIX =
  /^(?:(?:my|our|the)\s+(?:roblox\s+)?(?:game|experience)(?:\s+(?:is\s+)?(?:called|named|titled))?|(?:an?\s+)?(?:roblox\s+)?(?:game|experience)\s+(?:called|named|titled))\s*[:-]?\s+/i
// A pasted full prompt: " in the style of my reference image. No text. 16:9 Ratio."
const PROMPT_SUFFIX = /(?:\s+(?:in the style of|styled (?:like|after)|based on)\b.*|[.!]?\s*no text\b.*)$/i

/**
 * The game name exactly as typed, minus any "make me a thumbnail for my game"
 * wrapper around it. A description is a name too and comes back untouched:
 * "A axe throwing game with a bacon hair in the thumbnail" stays word for word.
 */
export function extractGameName(input) {
  const text = input.trim()
  const quoted = text.match(QUOTED_NAME)?.[1]?.trim()
  if (quoted) return quoted
  const name = text.replace(REQUEST_PREFIX, '').replace(GAME_PREFIX, '').replace(PROMPT_SUFFIX, '').replace(/[\s.,;:]+$/, '')
  return stripQuotes(name) || text
}
