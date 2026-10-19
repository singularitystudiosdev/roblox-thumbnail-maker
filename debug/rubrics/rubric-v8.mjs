// Writes debug/rubrics/judge-rubric-v8.txt: the shipped judge rubric with three lines rewritten so a main
// subject has to READ at feed size (a back-turned hero in a dark scene no longer counts as striking).
// Candidate for the Zombie Survivors miss; measure with
//   JUDGE_SYSTEM_FILE=debug/rubrics/judge-rubric-v8.txt node debug/rejudge.mjs 2
// and ship it into server/judge.mjs only when that beats the shipped rubric on the same split.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const { JUDGE_SYSTEM } = await import('../../server/judge.mjs')
const swaps = [
  [
    'A view that puts the player inside the action (over the shoulder, point of view, a low or high angle, a scope or camera view) is striking, and a character seen from behind is fine in such a view. One dominant subject beats several medium-size ones, and a busy scene full of props reads worse than one subject with a few big props.',
    'A view that puts the player inside the action (over the shoulder, point of view, a low or high angle, a scope or camera view) can be striking, but only while it still reads: at feed size a player must see who the characters are and what is happening. Faces and expressions they can see make characters read; a main character turned away so its face and action are hidden, or lost in a dark, murky scene, does not read and does not dominate however large it is. A dark mood is fine while the characters and the action stay clear. One dominant subject that reads beats several medium-size ones, and a busy scene full of props reads worse than one subject with a few big props.'
  ],
  [
    'Two or more characters of similar medium size side by side, with none dominant, score at most 6.',
    'Two or more characters of similar medium size side by side, with none dominant, score at most 6, unless the scene is clear and bright and every character reads well, with good-looking faces and a clear action: then it scores up to 8, above a large subject that does not read.'
  ],
  [
    "Showing more of the name's items or a busier scene never wins over a bolder thumbnail with one dominant subject.",
    "Showing more of the name's items or a busier scene never wins over a bolder thumbnail with one dominant subject that reads clearly; a clear, flawless scene whose characters look good beats a bold one that is hard to read."
  ]
]
let text = JUDGE_SYSTEM
for (const [from, to] of swaps) {
  if (!text.includes(from)) throw new Error(`The shipped rubric no longer holds the line to rewrite: ${from.slice(0, 60)}`)
  text = text.replace(from, to)
}
const out = fileURLToPath(new URL('./judge-rubric-v8.txt', import.meta.url))
writeFileSync(out, text)
console.log('candidate rubric written to', out, text.length, 'chars, shipped', JUDGE_SYSTEM.length)
