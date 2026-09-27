import { readFile } from 'node:fs/promises'

import type { Project } from './home.ts'

// An open item, as kf-meta writes them: `- [ ] **Title** — body`. Plain `- [ ] text` works too.
export type OpenItem = { title: string; body: string }

const TASK = /^\s*[-*] \[ \] (.*)$/
const BOLD = /^\*\*(.+?)\*\*\s*(?:[—–-]\s*)?(.*)$/

export function parseItems(markdown: string): OpenItem[] {
  const out: OpenItem[] = []
  for (const line of markdown.split('\n')) {
    const m = TASK.exec(line)
    if (!m?.[1]) continue
    const b = BOLD.exec(m[1])
    out.push(b ? { title: b[1] ?? '', body: b[2] ?? '' } : { title: m[1], body: '' })
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
