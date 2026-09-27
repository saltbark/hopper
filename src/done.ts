import { join } from 'node:path'

import { readIfThere, writeJson } from './fsutil.ts'

// Conversations I've marked done. Claude Code reports a finished turn as "done" too, but that
// only means Claude is waiting for me, so being done is my call, kept in Hopper's home folder.

const file = (home: string) => join(home, 'state', 'done.json')

export async function loadDone(home: string): Promise<Set<string>> {
  try {
    const raw = JSON.parse((await readIfThere(file(home))) ?? '{}') as { sessions?: unknown }
    const sessions = Array.isArray(raw.sessions) ? raw.sessions : []
    return new Set(sessions.filter((s): s is string => typeof s === 'string'))
  } catch {
    return new Set()
  }
}

export const saveDone = (home: string, done: Set<string>) =>
  writeJson(file(home), { sessions: [...done].sort() })
