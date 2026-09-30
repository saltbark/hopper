import { join } from 'node:path'

import { inTurn, readForChange, readIfThere, writeJson } from './fsutil.ts'

// Conversations I've marked done. Claude Code reports a finished turn as "done" too, but that
// only means Claude is waiting for me, so being done is my call, kept in Hopper's home folder.

const file = (home: string) => join(home, 'state', 'done.json')

function parseDone(text: string | null): Set<string> {
  const raw = JSON.parse(text ?? '{}') as { sessions?: unknown }
  const sessions = Array.isArray(raw.sessions) ? raw.sessions : []
  return new Set(sessions.filter((s): s is string => typeof s === 'string'))
}

// For showing: a file that can't be read shows nothing as done.
export async function loadDone(home: string): Promise<Set<string>> {
  try {
    return parseDone(await readIfThere(file(home)))
  } catch {
    return new Set()
  }
}

// Marks one conversation done, or not.
export const setDone = (home: string, sessionId: string, done: boolean) =>
  inTurn(file(home), async () => {
    const set = await readForChange(file(home), parseDone)
    if (done) set.add(sessionId)
    else set.delete(sessionId)
    await writeJson(file(home), { sessions: [...set].sort() })
  })
