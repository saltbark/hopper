// The rows of the Projects panel: with nothing typed, the projects with something going on; as you
// type, every project and folder that matches (App ranks the keys, rollUp gives each its counts).

import { inScope } from './model.ts'

export type Counts = { open: number; run: number; you: number }

export type ProjectRow = {
  key: string
  // A folder above projects matches too (pm/lantern/apps) and narrows the list to all of them.
  isProject: boolean
  counts: Counts
  // When a conversation there last started or a draft was last edited.
  last: number
}

export type ProjectStat = { key: string; counts: Counts; last: number }

// Something going on: the project the list is narrowed to, then those waiting on you, then
// running, then any used in the last day.
export const RECENT_MS = 24 * 60 * 60 * 1000

export function activeRows(
  projects: ProjectStat[],
  scope: string | null,
  now: number,
): ProjectRow[] {
  const recent = (p: { last: number }) => p.last > 0 && now - p.last < RECENT_MS
  return projects
    .filter((p) => p.key === scope || p.counts.you || p.counts.run || recent(p))
    .sort(
      (a, b) =>
        Number(b.key === scope) - Number(a.key === scope) ||
        b.counts.you - a.counts.you ||
        b.counts.run - a.counts.run ||
        b.last - a.last,
    )
    .map((p) => ({ ...p, isProject: true }))
}

// A key's row: a project's own numbers, or a folder's summed over the projects in it.
export function rollUp(key: string, projects: ProjectStat[]): ProjectRow {
  const under = projects.filter((p) => inScope(p.key, key))
  return {
    key,
    isProject: projects.some((p) => p.key === key),
    counts: under.reduce(
      (c, p) => ({
        open: c.open + p.counts.open,
        run: c.run + p.counts.run,
        you: c.you + p.counts.you,
      }),
      { open: 0, run: 0, you: 0 },
    ),
    last: Math.max(0, ...under.map((p) => p.last)),
  }
}
