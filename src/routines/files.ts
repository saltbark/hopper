import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { parseFrontmatter, serializeFrontmatter } from '../frontmatter.ts'
import { readIfThere, writeAtomic } from '../fsutil.ts'
import { checkSchedule } from './schedule.ts'

// A routine is a prompt that runs on a schedule. Each run is its own conversation; what lasts
// is the prompt, tweaked over time. Anything a run should remember goes through files.

export type Routine = {
  name: string
  project: string
  schedule: string // in words, "weekdays 7:00"; empty means run-now only
  model?: string
  effort?: string
  enabled: boolean
  prompt: string
  // A shell command run first, in the project's run folder. If it passes, no conversation starts.
  check?: string
}

export const ROUTINE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/

export const routinesDir = (home: string) => join(home, 'routines')
const file = (home: string, name: string) => join(routinesDir(home), `${name}.md`)

export const serializeRoutine = (r: Routine): string =>
  serializeFrontmatter(
    {
      project: r.project,
      schedule: r.schedule,
      model: r.model,
      effort: r.effort,
      enabled: String(r.enabled),
      check: r.check,
    },
    `${r.prompt.replace(/\s*$/, '')}\n`,
  )

export function parseRoutine(name: string, text: string): Routine | null {
  const parsed = parseFrontmatter(text)
  const f = parsed?.fields
  if (!parsed || !f?.['project']) return null
  const r: Routine = {
    name,
    project: f['project'],
    schedule: f['schedule'] ?? '',
    enabled: f['enabled'] !== 'false',
    prompt: parsed.body.replace(/\s*$/, ''),
  }
  if (f['model']) r.model = f['model']
  if (f['effort']) r.effort = f['effort']
  if (f['check']) r.check = f['check']
  return r
}

export async function listRoutines(home: string): Promise<Routine[]> {
  const names = await readdir(routinesDir(home)).catch(() => [] as string[])
  const all = await Promise.all(
    names
      .filter((n) => n.endsWith('.md'))
      .map(async (n) =>
        parseRoutine(n.slice(0, -3), (await readIfThere(join(routinesDir(home), n))) ?? ''),
      ),
  )
  return all.filter((r): r is Routine => !!r).sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadRoutine(home: string, name: string): Promise<Routine | null> {
  const text = await readIfThere(file(home, name)).catch(() => null)
  return text === null ? null : parseRoutine(name, text)
}

export async function saveRoutine(home: string, r: Routine): Promise<void> {
  if (!ROUTINE_NAME.test(r.name))
    throw new Error('Routine names are lowercase letters, digits and hyphens.')
  const problem = checkSchedule(r.schedule)
  if (problem) throw new Error(problem)
  await writeAtomic(file(home, r.name), serializeRoutine(r))
}

export async function deleteRoutine(home: string, name: string): Promise<void> {
  await rm(file(home, name), { force: true })
}
