import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { addAccount, setPrefixes, type Config } from '../src/config.ts'
import { initHome, loadProjects } from '../src/home.ts'
import type { Snapshot } from '../src/model.ts'
import {
  buildRows,
  nextOption,
  parseProjectsDoc,
  serializeProjectsDoc,
  setField,
} from '../src/settings.ts'
import { App } from '../src/tui/App.tsx'

const base = (home: string): Config => {
  let c: Config = {
    path: '/c/config.toml',
    accountsPath: '/c/accounts.toml',
    home,
    accounts: [],
    routes: [],
  }
  c = addAccount(c, { name: 'kf', label: 'Knowledge Futures', configDir: null })
  c = addAccount(c, { name: 'sb', label: 'sb', configDir: '/tmp/hopper-test-sb' })
  return c
}

const TOML = `# my header
# second line

[[project]]
key = "meta/inbox"
model = "opus"

[[source]]
prefix = "kf"
repo = "/no/such/kf-meta"
`

describe('projects.toml as a document', () => {
  it('keeps the header, sets and clears fields, and round-trips', () => {
    const doc = parseProjectsDoc(TOML)
    expect(doc.header).toBe('# my header\n# second line')
    const set = setField(doc, 'source', 0, 'run_in', 'project')
    const text = serializeProjectsDoc(setField(set, 'project', 0, 'model', null))
    expect(text.startsWith('# my header\n# second line\n\n')).toBe(true)
    const back = parseProjectsDoc(text)
    expect(back.source[0]).toEqual({ prefix: 'kf', repo: '/no/such/kf-meta', run_in: 'project' })
    expect(back.project[0]).toEqual({ key: 'meta/inbox' })
  })
  it('cycles choices through the default', () => {
    expect(nextOption(['', 'project'], '')).toBe('project')
    expect(nextOption(['', 'project'], 'project')).toBe('')
  })
})

describe('rows', () => {
  it('says when no account runs a prefix, and marks what is set', () => {
    const config = setPrefixes(base('/h'), 'sb', ['sb/'])
    const projects = [
      { key: 'meta/inbox', path: '/h/projects/meta/inbox', runIn: '/h', openFile: '' },
      {
        key: 'sb/hopper',
        path: '/w/hopper',
        runIn: '/w/sb-meta',
        openFile: '',
        meta: { repo: '/w/sb-meta', key: 'saltbark/hopper' },
      },
    ]
    const rows = buildRows(config, parseProjectsDoc(TOML), projects, ['kf'])
    expect(rows.find((r) => r.id === 'accounts.uncovered')?.label).toBe('! nothing runs meta/')
    const model = rows.find((r) => r.id === 'project.0.model')
    expect(model).toMatchObject({ value: 'opus', isSet: true })
    const runIn = rows.find((r) => r.id === 'source.0.run_in')
    expect(runIn).toMatchObject({ value: 'repo', isSet: false })
    expect(rows.find((r) => r.id === 'source.0.repo')).toMatchObject({
      warn: 'not on this machine',
    })
  })
})

describe('the settings screen', () => {
  it('opens with s, changes a choice with enter, and writes it to projects.toml', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-settings-'))
    await initHome(home)
    await writeFile(join(home, 'projects.toml'), TOML)
    const config = setPrefixes(base(home), 'kf', ['', 'kf/'])
    const projects = await loadProjects(home)
    const snap: Snapshot = {
      at: Date.now(),
      drafts: [],
      routines: [],
      runs: [],
      results: {},
      projects,
      projectsError: null,
      openCounts: new Map(),
      accounts: [],
      items: [],
    }
    const { lastFrame, stdin, unmount } = render(<App config={config} load={async () => snap} />)
    const press = async (k: string) => {
      stdin.write(k)
      await new Promise((r) => setTimeout(r, 40))
    }
    await press('')
    await press('s')
    expect(lastFrame()).toContain('SETTINGS')
    await press('J') // accounts
    await press('J') // sources
    expect(lastFrame()).toContain('SOURCES')
    for (let i = 0; i < 5; i++) await press('j') // group, prefix, repo, strip, run in
    expect(lastFrame()).toContain('⏎ next choice')
    await press('\r')
    await new Promise((r) => setTimeout(r, 150))
    expect(await readFile(join(home, 'projects.toml'), 'utf8')).toContain('run_in = "project"')
    expect(lastFrame()).toContain('run in saved')
    await press('d')
    await new Promise((r) => setTimeout(r, 150))
    expect(await readFile(join(home, 'projects.toml'), 'utf8')).not.toContain('run_in')
    await press('\u001b')
    expect(lastFrame()).not.toContain('SETTINGS')
    unmount()
  })
})
