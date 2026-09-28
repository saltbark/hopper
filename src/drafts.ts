import { readdir, rm, stat } from 'node:fs/promises'
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

const INBOX = 'meta/inbox'

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

// A file with no front matter is a note dropped in from elsewhere (the phone, through Dropbox):
// it files to meta/inbox and takes its times from the file. It gets front matter on first save.
export function parseDraft(id: string, text: string, fileTime = 0): Draft | null {
  const parsed = parseFrontmatter(text.replace(/\r\n/g, '\n'))
  if (!parsed) {
    if (!text.trim()) return null
    return { id, project: INBOX, text, created: fileTime, updated: fileTime }
  }
  const f = parsed.fields
  const draft: Draft = {
    id,
    project: f['project'] || INBOX,
    text: parsed.body,
    created: timeField(f['created']) || fileTime,
    updated: timeField(f['updated']) || fileTime,
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
      .map(async (n) => {
        const path = join(dir(home), n)
        const text = await readIfThere(path)
        if (text === null) return null
        const mtime = await stat(path).then(
          (s) => s.mtimeMs,
          () => 0,
        )
        return parseDraft(n.slice(0, -3), text, mtime)
      }),
  )
  return drafts.filter((d): d is Draft => !!d).sort((a, b) => b.updated - a.updated)
}

export const saveDraft = (home: string, d: Draft) =>
  writeAtomic(file(home, d.id), serializeDraft(d))

export async function deleteDraft(home: string, id: string): Promise<void> {
  await rm(file(home, id), { force: true })
}
