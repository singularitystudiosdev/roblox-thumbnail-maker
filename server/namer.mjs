// Turns the game the user means (its Roblox description, or just their words)
// into a short title that says what the player does: "Break and Steal an Egg
// from an Animal". The text model on fal.ai first (Claude Haiku: about 1s and the
// closest to this style in a side-by-side test), then Gemini, then the game's
// own name tidied up.
import { config } from './env.mjs'
import { falRun } from './fal.mjs'
import { generateText } from './gemini.mjs'

export const NAME_SYSTEM = `You name a Roblox game by describing what it is, in the style of a Roblox game title.
Examples of the style: "Grow a Garden", "Rob a Bank", "Break and Steal an Egg from an Animal".
How to write it:
- Start from the game's name and keep its words where they fit, then add the one detail the description adds that the name leaves out (what you take, from whom, where, or why). Example: a game named "Break and Steal an Egg" whose eggs hatch animals becomes "Break and Steal an Egg from an Animal".
- One idea, said as one phrase: no commas, no lists, no "and" chains of three things.
- 3 to 8 words. Stay as short as "Rob a Bank" when the name already says what the description does.
- Title Case like the examples (a, an, and, the, from, of, to, with, for stay lowercase unless first).
- Plain words only: no emoji, brackets, quotes, update or event tags, dashes, colons, or hype words like Ultimate, Epic or Best.
- If no game description is given, tidy the user's own words into a title without inventing a different game.
Reply with the title only.`

const DESCRIPTION_LIMIT = 1500
const MAX_WORDS = 10
const MAX_CHARS = 80

/** A title with Roblox decoration removed: [🎃] tags, (READ DESC), emoji, quotes, dashes, trailing punctuation. */
export function cleanTitle(value) {
  return String(value ?? '')
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, ' ')
    .replace(/["“”]/g, ' ')
    .replace(/\s*[—–]\s*|\s+-{1,2}\s+/g, ' ')
    .replace(/[:|•★☆]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s'`.,;!?]+|[\s'`.,;!?]+$/g, '')
}

/** The model's answer as a title, or null when it is empty or too long to be one. */
export function acceptTitle(raw) {
  const line = String(raw ?? '').split('\n').map((s) => s.trim()).find(Boolean) ?? ''
  const title = cleanTitle(line.replace(/^title\s*:\s*/i, ''))
  const words = title.split(' ').filter(Boolean)
  return title && words.length <= MAX_WORDS && title.length <= MAX_CHARS ? title : null
}

/** What the model reads: the request (a pasted Roblox link replaced by the game's name) and the game's description. */
export function nameRequest(request, game) {
  const said = request.replace(/(?:https?:\/\/)?(?:www\.)?roblox\.com\/\S*/gi, game?.name ?? '').replace(/\s+/g, ' ').trim()
  const head = `User's request: ${said}\n`
  if (!game) return `${head}No Roblox game matched.`
  const description = game.description.trim().slice(0, DESCRIPTION_LIMIT) || '(no description)'
  return `${head}Roblox game they mean: ${game.name}\nGame description:\n${description}`
}

/** The title for the prompt and which route wrote it ('gemini', 'fal', or 'fallback'). */
export async function describeGame({ request, typed, game }) {
  const userText = nameRequest(request, game)
  const routes = [
    [
      'fal',
      async () =>
        (
          await falRun(
            'openrouter/router',
            { model: config().falTextModel, system_prompt: NAME_SYSTEM, prompt: userText, temperature: 0, max_tokens: 40 },
            30000
          )
        )?.output
    ],
    ['gemini', () => generateText(NAME_SYSTEM, userText)]
  ]
  for (const [namedBy, call] of routes) {
    try {
      const title = acceptTitle(await call())
      if (title) return { title, namedBy }
      console.warn(`Game naming via ${namedBy} returned an unusable title.`)
    } catch (err) {
      console.error(`Game naming via ${namedBy} failed:`, err)
    }
  }
  return { title: cleanTitle(game?.name) || typed, namedBy: 'fallback' }
}
