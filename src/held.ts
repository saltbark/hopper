import { join } from 'node:path'

import { inTurn, readForChange, readIfThere, writeJson } from './fsutil.ts'

// Conversations I've put on hold: waiting on me, but I know about them and can't act yet (a
// meeting first). Each is kept with when I held it; a reply from Claude after that ends the hold
// (gather in model.ts), so a conversation that moves on comes back as new.

const file = (home: string) => join(home, 'state', 'held.json')

function parseHeld(text: string | null): Map<string, number> {
  const raw = JSON.parse(text ?? '{}') as { sessions?: unknown }
  const sessions =
    raw.sessions && typeof raw.sessions === 'object' ? Object.entries(raw.sessions) : []
  return new Map(sessions.filter((e): e is [string, number] => typeof e[1] === 'number'))
}

// For showing: a file that can't be read holds nothing.
export async function loadHeld(home: string): Promise<Map<string, number>> {
  try {
    return parseHeld(await readIfThere(file(home)))
  } catch {
    return new Map()
  }
}

// Puts one conversation on hold, or takes it off.
export const setHeld = (home: string, sessionId: string, held: boolean, now = Date.now()) =>
  inTurn(file(home), async () => {
    const map = await readForChange(file(home), parseHeld)
    if (held) map.set(sessionId, now)
    else map.delete(sessionId)
    const sessions = Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)))
    await writeJson(file(home), { sessions })
  })
