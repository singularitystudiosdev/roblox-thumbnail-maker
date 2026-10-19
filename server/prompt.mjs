// The prompts the image model receives, word for word. Thumbnail 1 is the
// template with only GAME_NAME substituted (inside the quotes); thumbnails 2
// to 4 each send the one remix prompt with the Roblox reference, so a run
// gets three separate draws of it.
export const PROMPT_TEMPLATE =
  'Make me a thumbnail for my roblox game "GAME_NAME" in the style of my reference image different characters. No text. 16:9 Ratio.'

export const REMIX_PROMPT = 'Make this thumbnail but from a novel perspective. No text.'
export const REMIX_COUNT = 3

export const stripQuotes = (value) => value.trim().replace(/^["“”']+|["“”']+$/g, '').trim()

export function buildPrompt(gameName) {
  // The template supplies the quotes, so a name typed in quotes is not quoted twice.
  const name = stripQuotes(String(gameName ?? ''))
  if (!name) throw new Error('A game name is required to build the prompt.')
  // A function replacement, so "$&" or "$1" in a name is inserted literally.
  return PROMPT_TEMPLATE.replace('GAME_NAME', () => name)
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
