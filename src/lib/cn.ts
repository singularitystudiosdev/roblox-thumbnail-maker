/* cn(): the shadcn class-merging convention this skill's templates share.
   Source: source-github.md §2 (shadcn-ui/ui, MIT, 122,966 stars,
   https://github.com/shadcn-ui/ui): "cn() with clsx + tailwind-merge, data-slot
   attributes" is the convention taken from that repo, not the package.
   Dependencies are pinned in the repo stack: clsx + tailwind-merge, nothing else. */

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
