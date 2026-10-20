// Writes debug/rubrics/judge-rubric-v9.txt: the shipped judge rubric with outlines exempted when the game's own
// thumbnail has them. The shipped line "a flat 2D or outlined drawing scores 1 to 4 against a 3D render" beat the
// rule to match the game's own render style: on STEAL COOKIES (a linked run whose own thumbnail draws its characters
// with thick sticker outlines) the creator took the remix that kept those outlines and the judge marked it down as
// "a cutout effect". Separate from v8 so each change is measured on its own; measure with
//   JUDGE_SYSTEM_FILE=debug/rubrics/judge-rubric-v9.txt node debug/rejudge.mjs 2
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const { JUDGE_SYSTEM } = await import('../../server/judge.mjs')
const swaps = [
  [
    'A flat 2D or outlined drawing scores 1 to 4 against a 3D render.',
    "A flat 2D or outlined drawing scores 1 to 4 against a 3D render, unless the game's own current thumbnail, shown as context, draws its characters the same way: outlines or a sticker look that the game's own thumbnail has are its signature style, so keeping them is right and never costs genreLook."
  ],
  [
    'No artifacts.',
    "No artifacts. Outlines around characters and objects that the game's own current thumbnail (the context image) also has are its art style, not a cutout or pasted-in look: they never cost clean points."
  ]
]
let text = JUDGE_SYSTEM
for (const [from, to] of swaps) {
  if (!text.includes(from)) throw new Error(`The shipped rubric no longer holds the line to rewrite: ${from.slice(0, 60)}`)
  text = text.replace(from, to)
}
const out = fileURLToPath(new URL('./judge-rubric-v9.txt', import.meta.url))
writeFileSync(out, text)
console.log('candidate rubric written to', out, text.length, 'chars, shipped', JUDGE_SYSTEM.length)
