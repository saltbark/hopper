import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { addAccount, OVERNIGHT_DEFAULTS, setPrefixes, type Config } from '../src/config.ts'
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
    overnight: OVERNIGHT_DEFAULTS,
  }
  c = addAccount(c, { name: 'bh', label: 'Blue Heron', configDir: null })
  c = addAccount(c, { name: 'pm', label: 'pm', configDir: '/tmp/hopper-test-pm' })
  return c
}

const TOML = `# my header
# second line

[[project]]
key = "meta/inbox"
model = "opus"

[[source]]
prefix = "bh"
repo = "/no/such/bh-meta"
`

describe('projects.toml as a document', () => {
  it('keeps the header, sets and clears fields, and round-trips', () => {
    const doc = parseProjectsDoc(TOML)
    expect(doc.header).toBe('# my header\n# second line')
    const set = setField(doc, 'source', 0, 'run_in', 'project')
    const text = serializeProjectsDoc(setField(set, 'project', 0, 'model', null))
    expect(text.startsWith('# my header\n# second line\n\n')).toBe(true)
    const back = parseProjectsDoc(text)
    expect(back.source[0]).toEqual({ prefix: 'bh', repo: '/no/such/bh-meta', run_in: 'project' })
    expect(back.project[0]).toEqual({ key: 'meta/inbox' })
  })
  it('cycles choices through the default', () => {
    expect(nextOption(['', 'project'], '')).toBe('project')
    expect(nextOption(['', 'project'], 'project')).toBe('')
  })
})

describe('rows', () => {
  it('says when no account runs a prefix, and marks what is set', () => {
    const config = setPrefixes(base('/h'), 'pm', ['pm/'])
    const projects = [
      { key: 'meta/inbox', path: '/h/projects/meta/inbox', runIn: '/h', openFile: '' },
      {
        key: 'pm/tern',
        path: '/w/hopper',
        runIn: '/w/pm-meta',
        openFile: '',
        meta: { repo: '/w/pm-meta', key: 'pinemoor/tern' },
      },
    ]
    const rows = buildRows(config, parseProjectsDoc(TOML), projects, ['bh'])
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

describe('the dim row', () => {
  const dim = (c: Config) => buildRows(c, null, [], []).find((r) => r.id === 'general.dim')
  it('names the default, calls 0 off, and steps darker from the default before wrapping', () => {
    expect(dim(base('/h'))).toMatchObject({ value: '38 (default)', raw: '', isSet: false })
    expect(dim({ ...base('/h'), dim: 0 })).toMatchObject({
      value: '0 (off)',
      raw: '0',
      isSet: true,
    })
    const row = dim({ ...base('/h'), dim: 65 })
    if (row?.kind !== 'setting' || row.edit.type !== 'choice') throw new Error('not a choice')
    expect(nextOption(row.edit.options, '')).toBe('50')
    expect(nextOption(row.edit.options, '80')).toBe('0')
    expect(nextOption(row.edit.options, '20')).toBe('')
  })
})

describe('the settings screen', () => {
  it('opens with a comma, changes a choice with enter, and writes it to projects.toml', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-settings-'))
    await initHome(home)
    await writeFile(join(home, 'projects.toml'), TOML)
    const config = setPrefixes(base(home), 'bh', ['', 'bh/'])
    const projects = await loadProjects(home)
    const snap: Snapshot = {
      at: Date.now(),
      drafts: [],
      routines: [],
      runs: [],
      reports: {},
      projects,
      projectsError: null,
      openCounts: new Map(),
      accounts: [],
      items: [],
    }
    const { lastFrame, stdin, unmount } = render(<App config={config} load={async () => snap} />)
    const until = async (ok: () => boolean) => {
      for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 20))
    }
    const press = async (k: string) => {
      stdin.write(k)
      await new Promise((r) => setTimeout(r, 40))
    }
    // The selection marker sits right before the row's own label in the list; matching on it
    // (rather than the About panel's wrapped help text) survives the list column's word wrap.
    const flat = () => (lastFrame() ?? '').replace(/\s+/g, ' ')
    // Waits for the row moved to to actually render before the next keystroke, so a dropped
    // keypress can't leave the cursor short of where the test expects it.
    const pressUntil = async (k: string, marker: string) => {
      stdin.write(k)
      await until(() => flat().includes(marker))
    }
    await press('')
    await press(',')
    expect(lastFrame()).toContain('SETTINGS')
    await press('J') // overnight
    await press('J') // accounts
    await press('J') // sources
    expect(lastFrame()).toContain('SOURCES')
    await pressUntil('j', '▌ bh/ ·') // group
    await pressUntil('j', '▌ prefix') // prefix
    await pressUntil('j', '▌ repo') // repo
    await pressUntil('j', '▌ strip') // strip
    await pressUntil('j', '▌ run in') // run in
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
  }, 15_000)
})
