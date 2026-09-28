import { readFile } from 'node:fs/promises'

import { readIfThere, writeAtomic } from './fsutil.ts'
import { guidePath } from './start.ts'

// The guide for agents, `docs/agents.md` in the repo, kept as the home folder's CLAUDE.md so
// every conversation that runs there loads it. Written only when it differs.
const source = new URL('../docs/agents.md', import.meta.url)

export async function writeGuide(home: string): Promise<boolean> {
  const text = await readFile(source, 'utf8').catch(() => null)
  if (text === null) return false
  const path = guidePath(home)
  if ((await readIfThere(path).catch(() => null)) === text) return false
  await writeAtomic(path, text)
  return true
}
