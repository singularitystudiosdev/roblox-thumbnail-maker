// The one prompt the image model ever receives: fixed text, only GAME_NAME
// substituted (inside quotes). Nothing else from the user's text reaches it.
export const PROMPT_TEMPLATE =
  'Make me a Roblox thumbnail for my game "GAME_NAME" in the style of my reference image different characters. No text. 16:9 Ratio.'

const stripQuotes = (value) => value.trim().replace(/^["“”']+|["“”']+$/g, '').trim()

export function buildPrompt(gameName) {
  const name = stripQuotes(gameName)
  if (!name) throw new Error('A game name is required to build the prompt.')
  return PROMPT_TEMPLATE.replace('GAME_NAME', name)
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

/** The game name exactly as typed, minus any "make me a thumbnail for my game" wrapper around it. */
export function extractGameName(input) {
  const text = input.trim()
  const quoted = text.match(QUOTED_NAME)?.[1]?.trim()
  if (quoted) return quoted
  const name = text.replace(REQUEST_PREFIX, '').replace(GAME_PREFIX, '').replace(PROMPT_SUFFIX, '').replace(/[\s.,;:]+$/, '')
  return stripQuotes(name) || text
}
