import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import type { Session } from '../src/claude.ts'
import { addAccount, OVERNIGHT_DEFAULTS, setPrefixes, type Config } from '../src/config.ts'
import { parseDraft, serializeDraft } from '../src/drafts.ts'
import { parseItems } from '../src/items.ts'
import { toItems, type Snapshot } from '../src/model.ts'
import { hopperPrompt } from '../src/prompts.ts'
import { App } from '../src/tui/App.tsx'

const OPEN = `# Atlas: open

**Now:** the map.

## Review
- [ ] **Tide tables**: read the harbour's tables
  every morning, and keep a week.

## Build
- [ ] **Chart the shoals** — from the survey.
- [ ] **Buoy list**: each buoy with its light.
- [x] **Done already**
`

describe('parseItems', () => {
  it('keeps the section each item is under, and lines carried on under it', () => {
    expect(parseItems(OPEN)).toEqual([
      {
        title: 'Tide tables',
        body: "read the harbour's tables every morning, and keep a week.",
        section: 'Review',
      },
      { title: 'Chart the shoals', body: 'from the survey.', section: 'Build' },
      { title: 'Buoy list', body: 'each buoy with its light.', section: 'Build' },
    ])
  })
})

describe('a draft for open items', () => {
  it('keeps their titles, commas and all, through the file', () => {
    const d = {
      id: 'x1',
      project: 'bh/atlas',
      text: 'go',
      created: 0,
      updated: 0,
      items: ['Tide tables, daily', 'Buoy list: lights'],
    }
    expect(parseDraft('x1', serializeDraft(d))?.items).toEqual(d.items)
  })

  it('tells the conversation which items it is for', () => {
    const p = {
      key: 'bh/atlas',
      path: '/w/atlas',
      runIn: '/w/atlas',
      openFile: '/w/atlas/_open.md',
    }
    expect(hopperPrompt(p, { items: ['Tide tables'] })).toContain(
      'It was started for this open item in that file: "Tide tables".',
    )
    expect(hopperPrompt(p)).not.toContain('started for')
  })
})

let config: Config = {
  path: '/c/config.toml',
  accountsPath: '/c/accounts.toml',
  home: '/h',
  accounts: [],
  routes: [],
  overnight: OVERNIGHT_DEFAULTS,
}
config = addAccount(config, { name: 'bh', label: 'Blue Heron', configDir: null })
config = addAccount(config, { name: 'pm', label: 'Pinemoor', configDir: '/tmp/hopper-test-pm' })
config = setPrefixes(setPrefixes(config, 'bh', ['bh/']), 'pm', ['pm/', 'meta/'])

const now = Date.now()
const session = (over: Partial<Session>): Session => ({
  account: 'bh',
  id: 'abc12345',
  sessionId: 's-' + over.name,
  kind: 'background',
  cwd: '/elsewhere',
  name: 'x',
  startedAt: now - 60_000,
  state: 'working',
  ...over,
})

async function world() {
  const dir = await mkdtemp(join(tmpdir(), 'hopper-items-'))
  const openFile = join(dir, '_open.md')
  await writeFile(openFile, OPEN)
  const projects = [
    { key: 'bh/atlas', path: join(dir, 'atlas'), runIn: join(dir, 'atlas'), openFile },
    { key: 'pm/tern', path: join(dir, 'tern'), runIn: join(dir, 'tern'), openFile: '' },
  ]
  const items = toItems(
    [
      session({ name: 'Survey the shoals', cwd: projects[0]!.path, id: 'aaa11111' }),
      session({
        name: 'Ring the terns',
        cwd: projects[1]!.path,
        account: 'pm',
        id: 'bbb22222',
        state: 'blocked',
      }),
    ],
    projects,
  )
  items[0]!.items = ['Chart the shoals']
  const account = (a: Config['accounts'][number]) => ({
    account: a,
    auth: { loggedIn: true },
    authError: null,
    usage: null,
    sessionError: null,
    sessions: [],
    sessionsAt: null,
    counts: { queue: 0, needs: 0, done: 0, live: 0 },
  })
  const snap: Snapshot = {
    at: now,
    drafts: [],
    routines: [],
    runs: [],
    reports: {},
    projects,
    projectsError: null,
    openCounts: new Map([['bh/atlas', 3]]),
    accounts: config.accounts.map(account),
    items,
  }
  return { home: dir, snap }
}

const tick = () => new Promise((r) => setTimeout(r, 30))
const until = async (ok: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 300 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 20))
}
const press = async (stdin: { write: (s: string) => void }, keys: string) => {
  stdin.write(keys)
  await tick()
}

describe('the list narrowed to an account', () => {
  it('⏎ on an account shows only its conversations; esc shows every one again', async () => {
    const { snap } = await world()
    const { lastFrame, stdin, unmount } = render(<App config={config} load={async () => snap} />)
    await tick()
    expect(lastFrame()).toContain('Ring the terns')
    await press(stdin, 'a')
    await press(stdin, 'j')
    await press(stdin, '\r')
    expect(lastFrame()).toMatch(/\(c\) ─+ on pm/)
    expect(lastFrame()).toContain('Ring the terns')
    expect(lastFrame()).not.toContain('Survey the shoals')
    expect(lastFrame()).toContain('every account')
    await press(stdin, '\u001b')
    expect(lastFrame()).toMatch(/\(c\) ─+ all projects/)
    expect(lastFrame()).toContain('Survey the shoals')
    unmount()
  })
})

describe('open items in full', () => {
  it('O shows every item with its section, text and what works on it', async () => {
    const { home, snap } = await world()
    const { lastFrame, stdin, unmount } = render(
      <App config={{ ...config, home }} load={async () => snap} />,
    )
    await tick()
    // The running conversation in bh/atlas is selected; its project's items show.
    await until(() => (lastFrame() ?? '').includes('Tide tables'))
    await press(stdin, 'O')
    await until(() => (lastFrame() ?? '').includes('↳'))
    const f = lastFrame() ?? ''
    expect(f).toContain('REVIEW')
    expect(f).toContain('BUILD')
    expect(f).toContain('every morning')
    expect(f).toContain('↳')
    expect(f).toContain('Survey the shoals')
    expect(f).not.toContain('Done already')
    expect(f).toContain('3 open')
    expect(f).toContain('Survey the shoals        ◆1')
    await press(stdin, '\u001b')
    expect(lastFrame()).not.toContain('OPEN ITEMS')
    unmount()
  })

  it('space picks items, and tab starts a draft that names them and keeps them', async () => {
    const { home, snap } = await world()
    const { lastFrame, stdin, unmount } = render(
      <App config={{ ...config, home }} load={async () => snap} />,
    )
    await tick()
    await until(() => (lastFrame() ?? '').includes('Tide tables'))
    await press(stdin, 'O')
    await until(() => (lastFrame() ?? '').includes('BUILD'))
    await press(stdin, ' ')
    await press(stdin, 'J')
    await press(stdin, 'j')
    await press(stdin, ' ')
    await until(() => (lastFrame() ?? '').includes('● Buoy list'))
    expect(lastFrame()).toContain('● Tide tables')
    expect(lastFrame()).toContain('● Buoy list')
    expect(lastFrame()).toContain('◆ Chart the shoals')
    await press(stdin, '\t')
    await until(() => !(lastFrame() ?? '').includes('OPEN ITEMS'))
    expect(lastFrame()).toContain('Tide tables · Buoy list')
    await press(stdin, '\u001b')
    // Only the draft itself: a write in progress has a file of its own beside it.
    const dir = join(home, 'drafts')
    const drafts = async () => (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.md'))
    await until(async () => (await drafts()).length > 0)
    const [name] = await drafts()
    const saved = parseDraft('d', await readFile(join(dir, name!), 'utf8'))
    expect(saved?.project).toBe('bh/atlas')
    expect(saved?.items).toEqual(['Tide tables', 'Buoy list'])
    unmount()
  })
})
