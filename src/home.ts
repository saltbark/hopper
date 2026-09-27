import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse } from 'smol-toml'

import { expandHome } from './paths.ts'

// A project Hopper knows about. Keys are folder-like: meta/inbox, kf/aas/bulletin.
export type Project = {
  key: string
  // Where agents run for it, and what sessions are matched against.
  path: string
  // Its list of open items.
  openFile: string
  // What new conversations here start with, unless the draft says otherwise.
  model?: string
  effort?: string
}

const KEY = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/

export const DEFAULT_PROJECTS = `# Every project Hopper knows about. A key is Hopper's own name for it: rename to reorganise.
# path defaults to <home>/projects/<key>, and open_file to <path>/_open.md. model and effort set
# what new conversations here start with (haiku, sonnet, opus, fable; low, medium, high).

[[project]]
key = "meta/inbox"

[[project]]
key = "meta/ideas"
`

export function parseProjects(text: string, home: string): Project[] {
  const raw = parse(text) as { project?: unknown }
  const list = Array.isArray(raw.project) ? raw.project : []
  const seen = new Set<string>()
  return list.map((entry, i) => {
    const p = (entry ?? {}) as Record<string, unknown>
    const key = p['key']
    if (typeof key !== 'string' || !KEY.test(key)) {
      throw new Error(`projects.toml entry ${i + 1}: key must look like "meta/inbox"`)
    }
    if (seen.has(key)) throw new Error(`projects.toml: "${key}" appears twice`)
    seen.add(key)
    const path = typeof p['path'] === 'string' ? expandHome(p['path']) : join(home, 'projects', key)
    const openFile =
      typeof p['open_file'] === 'string' ? expandHome(p['open_file']) : join(path, '_open.md')
    const project: Project = { key, path, openFile }
    if (typeof p['model'] === 'string' && p['model']) project.model = p['model']
    if (typeof p['effort'] === 'string' && p['effort']) project.effort = p['effort']
    return project
  })
}

export async function loadProjects(home: string): Promise<Project[]> {
  const text = await readFile(join(home, 'projects.toml'), 'utf8')
  return parseProjects(text, home)
}

// Open items are unchecked task lines, the kf-meta `_open.md` shape: `- [ ] **Title** — body`.
export function countOpen(markdown: string): number {
  let n = 0
  for (const line of markdown.split('\n')) if (/^\s*[-*] \[ \] /.test(line)) n++
  return n
}

export async function readOpenCount(project: Project): Promise<number | null> {
  try {
    return countOpen(await readFile(project.openFile, 'utf8'))
  } catch {
    return null
  }
}

const HOME_README = `# Hopper home

Hopper's own state. Not a git repo.

- \`projects.toml\`: every project Hopper knows about
- \`projects/<key>/_open.md\`: open items for projects that live here (the meta/ ones)
- \`ideas/\`: what the ideas routine writes
- \`state/\`: Hopper's log
`

async function writeIfMissing(path: string, text: string): Promise<boolean> {
  try {
    await writeFile(path, text, { flag: 'wx' })
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw e
  }
}

// Creates the home folder skeleton. Never overwrites. Returns the paths it created.
export async function initHome(home: string): Promise<string[]> {
  const created: string[] = []
  for (const dir of ['', 'ideas', 'state']) await mkdir(join(home, dir), { recursive: true })
  if (await writeIfMissing(join(home, 'README.md'), HOME_README)) created.push('README.md')
  if (await writeIfMissing(join(home, 'projects.toml'), DEFAULT_PROJECTS))
    created.push('projects.toml')
  for (const project of parseProjects(DEFAULT_PROJECTS, home)) {
    await mkdir(project.path, { recursive: true })
    if (await writeIfMissing(project.openFile, `# ${project.key}\n\n## Open\n`)) {
      created.push(join('projects', project.key, '_open.md'))
    }
  }
  return created
}
