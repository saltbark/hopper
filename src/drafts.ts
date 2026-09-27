import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { parseFrontmatter, serializeFrontmatter, timeField } from './frontmatter.ts'
import { readIfThere, writeAtomic } from './fsutil.ts'

// A conversation that hasn't started yet: somewhere to take your time with the first message.
// It saves as you type, waits in Needs you, and starts when you say so. Kept in the home folder.
export type Draft = {
  id: string
  project: string
  text: string
  created: number
  updated: number
  model?: string
  effort?: string
}

const dir = (home: string) => join(home, 'drafts')
const file = (home: string, id: string) => join(dir(home), `${id}.md`)

export const newDraftId = (now = Date.now()) =>
  `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export const serializeDraft = (d: Draft): string =>
  serializeFrontmatter(
    {
      project: d.project,
      created: new Date(d.created).toISOString(),
      updated: new Date(d.updated).toISOString(),
      model: d.model,
      effort: d.effort,
    },
    d.text,
  )

export function parseDraft(id: string, text: string): Draft | null {
  const parsed = parseFrontmatter(text)
  const f = parsed?.fields
  if (!parsed || !f?.['project']) return null
  const draft: Draft = {
    id,
    project: f['project'],
    text: parsed.body,
    created: timeField(f['created']),
    updated: timeField(f['updated']),
  }
  if (f['model']) draft.model = f['model']
  if (f['effort']) draft.effort = f['effort']
  return draft
}

export async function listDrafts(home: string): Promise<Draft[]> {
  const names = await readdir(dir(home)).catch(() => [] as string[])
  const drafts = await Promise.all(
    names
      .filter((n) => n.endsWith('.md'))
      .map(async (n) => parseDraft(n.slice(0, -3), (await readIfThere(join(dir(home), n))) ?? '')),
  )
  return drafts.filter((d): d is Draft => !!d).sort((a, b) => b.updated - a.updated)
}

export const saveDraft = (home: string, d: Draft) =>
  writeAtomic(file(home, d.id), serializeDraft(d))

export async function deleteDraft(home: string, id: string): Promise<void> {
  await rm(file(home, id), { force: true })
}
