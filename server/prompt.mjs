// The prompts the image model receives, word for word. Thumbnail 1 is the
// template with only GAME_NAME substituted (inside the quotes); thumbnail 2
// sends the remix prompt with the Roblox reference; thumbnail 3, the search
// meta, sends the plain template with the top game of a plain Roblox search
// (searchtop.mjs); thumbnail 4, the meta, sends the plain template with the
// same Roblox reference as thumbnail 2; thumbnail 5 sends the plain template
// with the style reference of thumbnail 1; thumbnails 6 and 7 send the remix
// prompt again with the same Roblox reference as thumbnail 2.
export const PROMPT_TEMPLATE =
  'Make me a thumbnail for my roblox game "GAME_NAME" in the style of my reference image different characters. No text. 16:9 Ratio.'

export const PLAIN_TEMPLATE = 'Make me a thumbnail for my game "GAME_NAME" in the style of my reference image. No text. 16:9 Ratio.'

export const REMIX_PROMPT = 'Make this thumbnail but from a novel perspective. No text.'

// The winning thumbnail, redrawn by the same model as a square Roblox icon (icon.mjs). Without the
// "continuing the same scene" sentence the model once filled the new height with a repeated strip.
export const ICON_PROMPT =
  'Resize this image to a 1:1 square. Keep everything in it fully in frame and unchanged: every character and object whole, nothing cut off. Fill the new space by continuing the same scene, never by repeating or tiling any part of the image. No text.'
export const REMIX_COUNT = 3

export const stripQuotes = (value) => value.trim().replace(/^["“”']+|["“”']+$/g, '').trim()

export function buildPrompt(gameName, template = PROMPT_TEMPLATE) {
  // The template supplies the quotes, so a name typed in quotes is not quoted twice.
  const name = stripQuotes(String(gameName ?? ''))
  if (!name) throw new Error('A game name is required to build the prompt.')
  // A function replacement, so "$&" or "$1" in a name is inserted literally.
  return template.replace('GAME_NAME', () => name)
}

// A name in double quotes at the start; an apostrophe ("Grandma's House") is part of a name, not a quote.
const LEADING_QUOTED_NAME = /^["“”]([^"“”]+)["“”]/
// "Make me a roblox thumbnail for", "can you create a thumbnail for", "thumbnail for"
const REQUEST_PREFIX =
  /^(?:(?:please|pls|can you|could you)\s+)*(?:(?:make|create|generate|design|draw|do|give)\s+(?:me\s+)?)?(?:an?\s+)?(?:(?:roblox|youtube|game|new)\s+)*thumbnails?\s+(?:for|of)\s+/i
// "my game", "the roblox game", "my game is called", "a game called"; never a bare "a game where ..."
const GAME_PREFIX =
  /^(?:(?:my|our|the)\s+(?:roblox\s+)?(?:game|experience)(?:\s+(?:is\s+)?(?:called|named|titled))?|(?:an?\s+)?(?:roblox\s+)?(?:game|experience)\s+(?:called|named|titled))\s*[:-]?\s+/i
// Only the tail of a pasted template prompt, at the very end: " in the style of my reference image
// different characters. No text. 16:9 Ratio." Words such as "based on", "in the style of Pixar"
// or "no text on the screen" inside a description are part of the name.
const PASTED_TEMPLATE_TAIL =
  /\s+in the style of my reference image(?:\s+different characters)?(?:\s*\.?\s*no text)?(?:\s*\.?\s*16:9 ratio)?\s*\.?\s*$/i

/**
 * The game name exactly as typed, minus any "make me a thumbnail for my game"
 * wrapper around it. A description is a name too and comes back untouched:
 * "A axe throwing game with a bacon hair in the thumbnail" stays word for word.
 * A quoted name counts only when it is the whole input or right after a
 * wrapper ("called", "for my game"): a quote inside a description is part of it.
 */
export function extractGameName(input) {
  const text = input.trim()
  const unwrapped = text.replace(REQUEST_PREFIX, '').replace(GAME_PREFIX, '')
  const rest = unwrapped.replace(PASTED_TEMPLATE_TAIL, '').replace(/[\s.,;:]+$/, '')
  const quoted = rest.match(LEADING_QUOTED_NAME)
  if (quoted && (unwrapped !== text || quoted[0] === rest)) return quoted[1].trim()
  // Quotes come off only when they wrap the whole name ('Lava Leap'), never one end of a description.
  const wrappedInQuotes = /^["“”'].*["“”']$/.test(rest)
  return (wrappedInQuotes ? stripQuotes(rest) : rest) || text
}
