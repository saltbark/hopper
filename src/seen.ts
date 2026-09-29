import { join } from 'node:path'

import { readIfThere, writeJson } from './fsutil.ts'

// Which routine reports I've read. A routine's row carries a dot while any of its reports is
// unread; reading one marks it, and M marks all of a routine's. Reports older than the file
// itself count as read, so the first look doesn't light every routine.

export type ReadState = {
  // When the file was made: everything written before it was already there to see.
  since: number
  // Per routine: every report up to `upTo` is read (M), and each path in `read` besides.
  routines: Record<string, { upTo?: number; read?: string[] }>
}

const file = (home: string) => join(home, 'state', 'read.json')

// Makes the file on the first look.
export async function loadRead(home: string, now = Date.now()): Promise<ReadState> {
  const text = await readIfThere(file(home)).catch(() => null)
  if (text !== null) {
    try {
      const raw = JSON.parse(text) as Partial<ReadState>
      if (typeof raw.since === 'number') return { since: raw.since, routines: raw.routines ?? {} }
    } catch {
      // unreadable: start again from now
    }
  }
  const fresh = { since: now, routines: {} }
  await writeJson(file(home), fresh)
  return fresh
}

export function isRead(s: ReadState, routine: string, rep: { path: string; at: number }): boolean {
  const r = s.routines[routine]
  return rep.at <= s.since || rep.at <= (r?.upTo ?? 0) || !!r?.read?.includes(rep.path)
}

type Rep = { path: string; at: number }

// Marks reports read. `reports` is the routine's current reports, so paths of reports that are
// gone, or covered by upTo, drop out and the list stays short.
export async function markRead(
  home: string,
  routine: string,
  paths: string[],
  reports: Rep[],
): Promise<void> {
  const s = await loadRead(home)
  const r = s.routines[routine] ?? {}
  const upTo = r.upTo ?? 0
  const keep = new Set(reports.filter((x) => x.at > upTo && x.at > s.since).map((x) => x.path))
  const read = [...new Set([...(r.read ?? []), ...paths])].filter((p) => keep.has(p))
  if (read.length === (r.read ?? []).length && read.every((p, i) => r.read?.[i] === p)) return
  await writeJson(file(home), { ...s, routines: { ...s.routines, [routine]: { ...r, read } } })
}

// Marks every report the routine has now as read.
export async function markAllRead(home: string, routine: string, reports: Rep[]): Promise<void> {
  const s = await loadRead(home)
  const r = s.routines[routine] ?? {}
  const upTo = Math.max(r.upTo ?? 0, ...reports.map((x) => x.at))
  await writeJson(file(home), { ...s, routines: { ...s.routines, [routine]: { upTo, read: [] } } })
}
