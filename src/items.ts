import { readFile } from 'node:fs/promises'

import type { Project } from './home.ts'
import type { Item } from './model.ts'

// An open item, as a meta repo's planning files write them: `- [ ] **Title** — body`. Plain
// `- [ ] text` works too. `section` is the heading it sits under (`## Build`), when there is one.
// Indented lines under an item that aren't items themselves carry on its body.
export type OpenItem = { title: string; body: string; section?: string }

const TASK = /^\s*[-*] \[ \] (.*)$/
const BOLD = /^\*\*(.+?)\*\*\s*(?:[—–:-]\s*)?(.*)$/
const HEADING = /^#{2,6}\s+(.*?)\s*#*\s*$/
// Any list item, open or not: it ends the item before it.
const ANY_TASK = /^\s*[-*] \[.\] /

export function parseItems(markdown: string): OpenItem[] {
  const out: OpenItem[] = []
  let section: string | undefined
  // The item still taking continuation lines, if any.
  let open: OpenItem | null = null
  for (const line of markdown.split('\n')) {
    const h = HEADING.exec(line)
    if (h) {
      section = h[1] || undefined
      open = null
      continue
    }
    const m = TASK.exec(line)
    if (m?.[1]) {
      const b = BOLD.exec(m[1])
      open = b ? { title: b[1] ?? '', body: b[2] ?? '' } : { title: m[1], body: '' }
      if (section) open.section = section
      out.push(open)
      continue
    }
    if (open && /^\s+\S/.test(line) && !ANY_TASK.test(line)) {
      const more = line.trim()
      open.body = open.body ? `${open.body} ${more}` : more
      continue
    }
    open = null
  }
  return out
}

export async function readItems(project: Project): Promise<OpenItem[] | null> {
  try {
    return parseItems(await readFile(project.openFile, 'utf8'))
  } catch {
    return null
  }
}

// What is working on an open item of a project: the drafts and conversations that were started
// for it, by its title, and haven't been archived. A title that changed in the file no longer
// matches, so nothing claims it.
export function workingOn(items: readonly Item[], key: string, title: string): Item[] {
  return items.filter(
    (i) => i.key === key && i.where !== 'done' && i.where !== 'filed' && !!i.items?.includes(title),
  )
}

// The titles of a project's open items that something is working on.
export function takenTitles(items: readonly Item[], key: string): Set<string> {
  const out = new Set<string>()
  for (const i of items)
    if (i.key === key && i.where !== 'done' && i.where !== 'filed')
      for (const t of i.items ?? []) out.add(t)
  return out
}
