// Prompt -> the game's name: the only thing taken from the user's text.
// Tries the Gemini API, then a text model on fal.ai, then a keyword fallback.
import { config } from './env.mjs'
import { falRun } from './fal.mjs'
import { generateJson } from './gemini.mjs'
import { buildPrompt, heuristicParse } from './prompt.mjs'

const NAME_SYSTEM = `You name a Roblox game from its developer's description.
Return:
- gameName: the name the user gave THEIR game, exactly as written and without quotes, or null if they gave none.
- suggestedName: when gameName is null, a short catchy Roblox-style title (2 to 4 words, like "Rob a Bank" or "Dig to Escape") that says what the player does; otherwise repeat gameName.`

const NAME_SCHEMA = {
  type: 'OBJECT',
  properties: {
    gameName: { type: 'STRING', nullable: true },
    suggestedName: { type: 'STRING' }
  },
  required: ['gameName', 'suggestedName']
}

async function nameViaFal(prompt) {
  const body = await falRun(
    'openrouter/router',
    {
      model: config().falTextModel,
      system_prompt: `${NAME_SYSTEM}\nAnswer with only a JSON object: {"gameName": string or null, "suggestedName": string}.`,
      prompt,
      temperature: 0.2,
      max_tokens: 200
    },
    60000
  )
  const json = String(body?.output ?? '').match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error(`fal ${config().falTextModel} returned no JSON: ${String(body?.output).slice(0, 120)}`)
  return JSON.parse(json)
}

async function parseName(prompt) {
  const routes = [
    ['gemini', () => generateJson(NAME_SYSTEM, prompt, NAME_SCHEMA)],
    ['fal', () => nameViaFal(prompt)]
  ]
  for (const [parsedBy, call] of routes) {
    try {
      const parsed = await call()
      if (parsed?.gameName?.trim() || parsed?.suggestedName?.trim()) return { ...parsed, parsedBy }
      throw new Error(`Empty name from ${parsedBy}: ${JSON.stringify(parsed)}`)
    } catch (err) {
      console.error(`Game naming via ${parsedBy} failed:`, err)
    }
  }
  return { ...heuristicParse(prompt), parsedBy: 'keywords' }
}

export async function planThumbnail(prompt) {
  const parsed = await parseName(prompt)
  const gameName = parsed.gameName?.trim() || parsed.suggestedName?.trim() || 'My Game'
  return {
    gameName,
    nameWasGiven: Boolean(parsed.gameName?.trim()),
    parsedBy: parsed.parsedBy,
    prompt: buildPrompt(gameName)
  }
}
