// The one prompt the image model ever receives: fixed text, only GAME_NAME
// substituted. The user's own description never reaches it.
export const PROMPT_TEMPLATE =
  'Make me a thumbnail for my game GAME_NAME in the style of my reference image different characters. No text. 16:9 Ratio.'

export function buildPrompt(gameName) {
  const name = gameName.trim().replace(/^["“”']+|["“”']+$/g, '').trim()
  if (!name) throw new Error('A game name is required to build the prompt.')
  return PROMPT_TEMPLATE.replace('GAME_NAME', name)
}

const STOP_WORDS = new Set(
  'a an and about for from game games i in into is it like make me my of on or roblox the thumbnail to where with want you your called named'.split(' ')
)

const titleCase = (word) => word.charAt(0).toUpperCase() + word.slice(1)

/** Used when the text model is unreachable: a stated name, else a title built from the prompt's keywords. */
export function heuristicParse(prompt) {
  const quoted = prompt.match(/["“']([^"”']{2,40})["”']/)
  const called = prompt.match(/\b(?:called|named|titled)\s+([A-Z0-9][\w'!: -]{1,40}?)(?=[,.;!?]|\s+(?:about|where|that|with)\b|$)/)
  const myGame = prompt.match(/\bmy game\s+([A-Z0-9][\w'!: -]{1,40}?)(?=[,.;!?]|\s+(?:is|where|about|that|with)\b|$)/i)
  const gameName = (quoted?.[1] ?? called?.[1] ?? myGame?.[1] ?? '').trim() || null
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
  return { gameName, suggestedName: gameName ?? (words.slice(0, 4).map(titleCase).join(' ') || 'My Game') }
}
