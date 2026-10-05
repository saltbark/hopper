import { render } from 'ink-testing-library'
import { expect, it } from 'vitest'

import type { Session } from '../src/claude.ts'
import { addAccount, OVERNIGHT_DEFAULTS, type Config } from '../src/config.ts'
import { toItems, type Snapshot } from '../src/model.ts'
import { App } from '../src/tui/App.tsx'

const config: Config = addAccount(
  {
    path: '/c/config.toml',
    accountsPath: '/c/accounts.toml',
    home: '/h',
    accounts: [],
    routes: [],
    overnight: OVERNIGHT_DEFAULTS,
  },
  { name: 'bh', label: 'BH', configDir: null },
)
const now = Date.now()
const session = (name: string, state: string, age: number): Session => ({
  account: 'bh',
  id: 'id-' + name,
  sessionId: 's-' + name,
  kind: 'background',
  cwd: '/elsewhere',
  name,
  startedAt: now - age,
  state,
})
const snapshot = (sessions: Session[], done: string[] = []): Snapshot => ({
  at: now,
  drafts: [],
  routines: [],
  runs: [],
  reports: {},
  projects: [],
  projectsError: null,
  openCounts: new Map(),
  accounts: [],
  items: toItems(sessions, [], new Set(done)),
})
const tick = () => new Promise((r) => setTimeout(r, 30))

// The row the list has selected: the one marked at its left edge.
const selected = (frame: string | undefined) =>
  (frame ?? '')
    .split('\n')
    .find((l) => l.startsWith('│▌'))
    ?.match(/[A-Z][a-z]+/)?.[0]

const start = async (sessions: Session[]) => {
  let current = snapshot(sessions)
  const app = render(<App config={config} load={async () => current} />)
  await tick()
  const press = async (keys: string) => {
    app.stdin.write(keys)
    await tick()
  }
  await press('c')
  // A new snapshot, read straight away as a refresh would.
  const change = async (next: Snapshot) => {
    current = next
    await press('R')
  }
  return { ...app, press, change }
}

const alpha = session('Alpha', 'blocked', 1000)
const bravo = session('Bravo', 'working', 2000)
const charlie = session('Charlie', 'working', 3000)

it('keeps the selected conversation when it moves to another group', async () => {
  // Running first, newest first: Bravo, Charlie, then Alpha waiting.
  const { lastFrame, press, change, unmount } = await start([alpha, bravo, charlie])
  await press('j')
  expect(selected(lastFrame())).toBe('Charlie')
  await change(snapshot([alpha, bravo, { ...charlie, state: 'blocked' }]))
  expect(selected(lastFrame())).toBe('Charlie')
  unmount()
})

it('keeps the selected conversation when another one moves above it', async () => {
  // Bravo running, then Alpha and Charlie waiting; Charlie starts working again, above Alpha.
  const { lastFrame, press, change, unmount } = await start([
    alpha,
    bravo,
    { ...charlie, state: 'blocked' },
  ])
  await press('j')
  expect(selected(lastFrame())).toBe('Alpha')
  await change(snapshot([alpha, bravo, charlie]))
  expect(selected(lastFrame())).toBe('Alpha')
  // And moving on from there goes on from where it is now.
  await press('k')
  expect(selected(lastFrame())).toBe('Charlie')
  unmount()
})

it('stays in the list on the next row when the selected one goes to Done', async () => {
  const { lastFrame, change, unmount } = await start([alpha, bravo, charlie])
  expect(selected(lastFrame())).toBe('Bravo')
  await change(snapshot([alpha, bravo, charlie], ['s-Bravo']))
  const f = lastFrame() ?? ''
  expect(selected(f)).toBe('Charlie')
  expect(f).toMatch(/ARCHIVED \(v\) ─+ 1/)
  // The right panel shows what is selected.
  expect(f).toContain('id-Charlie')
  unmount()
})
