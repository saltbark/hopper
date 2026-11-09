import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { OVERNIGHT_DEFAULTS, type Config } from '../src/config.ts'
import { loadDone } from '../src/done.ts'
import { listDrafts } from '../src/drafts.ts'
import { loadHeld } from '../src/held.ts'
import type { Item, Snapshot } from '../src/model.ts'
import { act } from '../src/remote/actions.ts'
import { listRoutines, saveRoutine, type Routine } from '../src/routines/index.ts'

// The phone's actions against a made-up home: they must do what the keys on the Mac do.

async function world() {
  const home = await mkdtemp(join(tmpdir(), 'hopper-act-'))
  const open = join(home, 'tern-open.md')
  await writeFile(
    open,
    '# pm/tern\n\n## Open\n- [ ] Move the job queue off cron\n- [ ] Rate limit the public API\n',
  )
  const account = { name: 'pm', label: 'Pinemoor', configDir: null }
  const config: Config = {
    path: join(home, 'config.toml'),
    accountsPath: join(home, 'accounts.toml'),
    home,
    accounts: [account],
    routes: [],
    overnight: OVERNIGHT_DEFAULTS,
  }
  const routine: Routine = {
    name: 'daily-brief',
    project: 'pm/tern',
    schedule: 'weekdays 7:00',
    enabled: false,
    prompt: 'Write the brief.',
  }
  await saveRoutine(home, routine)
  const item = (fields: Partial<Item>): Item => ({
    account: 'pm',
    id: 'e5c2a913',
    sessionId: 'sess-wait',
    kind: 'background',
    cwd: home,
    name: 'Rate limit the public API',
    startedAt: 1,
    state: 'blocked',
    where: 'needs',
    key: 'pm/tern',
    activeAt: 1,
    ...fields,
  })
  const snap: Snapshot = {
    at: 1,
    drafts: [],
    routines: [routine],
    runs: [],
    reports: {},
    projects: [{ key: 'pm/tern', path: home, runIn: home, openFile: open }],
    projectsError: null,
    openCounts: new Map(),
    accounts: [
      {
        account,
        auth: { loggedIn: true },
        authError: null,
        usage: null,
        sessionError: null,
        sessions: [],
        sessionsAt: null,
        counts: { queue: 0, needs: 1, done: 0, live: 0 },
      },
    ],
    items: [item({}), item({ sessionId: 'sess-run', where: 'queue', state: 'working' })],
  }
  let refreshed = 0
  const started: string[] = []
  const deps = {
    config,
    snap,
    refresh: async () => void refreshed++,
    start: (async (o: { draft: { text: string }; account: { name: string } }) => {
      started.push(`${o.account.name}: ${o.draft.text}`)
      return { id: 'x', name: 'pm/tern · ' + o.draft.text }
    }) as never,
    dispatch: async () => {},
    run: (async () => ({ status: 'started', id: 'r1', account: 'pm' })) as never,
  }
  return { home, deps, started, refreshed: () => refreshed }
}

describe("the phone's actions", () => {
  it('says what a new conversation in a project starts with', async () => {
    const { deps } = await world()
    const info = await act({ t: 'new', project: 'pm/tern', ref: 1 }, deps)
    expect(info).toMatchObject({
      t: 'newinfo',
      ref: 1,
      items: ['Move the job queue off cron', 'Rate limit the public API'],
      defaults: { model: 'opus[1m]', effort: 'high', worktree: 'yes' },
      route: 'pm',
    })
    expect(info['models']).toContain('sonnet')
  })

  it('starts through startDraft on the routed account, and queues by saving the draft', async () => {
    const { home, deps, started, refreshed } = await world()
    const r = await act({ t: 'start', project: 'pm/tern', text: 'Move it off cron', ref: 2 }, deps)
    expect(r).toMatchObject({ t: 'result', ref: 2, ok: true })
    expect(started).toEqual(['pm: Move it off cron'])

    const q = await act(
      { t: 'start', project: 'pm/tern', text: 'Tonight one', model: 'sonnet', queue: 'night' },
      deps,
    )
    expect(q).toMatchObject({ ok: true })
    const tonight = (await listDrafts(home)).find((d) => d.text === 'Tonight one')
    expect(tonight).toMatchObject({ queue: 'night', model: 'sonnet', project: 'pm/tern' })
    expect(refreshed()).toBe(2)

    // Saved as a draft: kept, not queued, nothing started.
    const d = await act({ t: 'start', project: 'pm/tern', text: 'Later, maybe', draft: true }, deps)
    expect(d).toMatchObject({ ok: true, text: 'Saved as a draft.' })
    const kept = (await listDrafts(home)).find((x) => x.text === 'Later, maybe')
    expect(kept?.queue).toBeUndefined()
    expect(started).toEqual(['pm: Move it off cron'])

    expect(await act({ t: 'start', project: 'pm/tern', text: '  ' }, deps)).toMatchObject({
      ok: false,
    })
    expect(await act({ t: 'start', project: 'zz/none', text: 'x' }, deps)).toMatchObject({
      ok: false,
    })
  })

  it('holds only what waits on you, and archives', async () => {
    const { home, deps } = await world()
    expect(await act({ t: 'hold', id: 'sess-wait' }, deps)).toMatchObject({
      ok: true,
      text: 'On hold: Rate limit the public API',
    })
    expect((await loadHeld(home)).has('sess-wait')).toBe(true)
    expect(await act({ t: 'hold', id: 'sess-run' }, deps)).toMatchObject({ ok: false })
    expect(await act({ t: 'done', id: 'sess-wait' }, deps)).toMatchObject({ ok: true })
    expect((await loadDone(home)).has('sess-wait')).toBe(true)
    expect(await act({ t: 'done', id: 'sess-wait', undo: true }, deps)).toMatchObject({
      ok: true,
      text: 'Back in conversations: Rate limit the public API',
    })
    expect((await loadDone(home)).has('sess-wait')).toBe(false)
  })

  it("tells the phone a routine's details and reads its reports, marking them read", async () => {
    const { home, deps } = await world()
    const file = join(home, '2026-11-08-0700.md')
    await writeFile(file, '# Overnight\n\n- Magic link sign-in is on a branch.\n')
    deps.snap.reports = {
      // Newer than the read state's start: older reports count as read already (seen.ts).
      'daily-brief': [
        { path: file, at: Date.now() + 60_000, needs: null, summary: 'Overnight', unread: true },
      ],
    }
    const info = await act({ t: 'routineinfo', id: 'routine:daily-brief', ref: 4 }, deps)
    expect(info).toMatchObject({
      t: 'routineinfo',
      ref: 4,
      name: 'daily-brief',
      schedule: 'weekdays 7:00',
      prompt: 'Write the brief.',
      model: 'opus[1m] (default)',
      reports: [{ file: '2026-11-08-0700.md', unread: true, summary: 'Overnight' }],
    })
    const rep = await act({ t: 'report', id: 'daily-brief', file: '2026-11-08-0700.md' }, deps)
    expect(rep).toMatchObject({ t: 'report', markdown: expect.stringContaining('Magic link') })
    expect(await readFile(join(home, 'state', 'read.json'), 'utf8')).toContain('2026-11-08-0700.md')
    // Never a path the routine doesn't list.
    expect(
      await act({ t: 'report', id: 'daily-brief', file: '../../config.toml' }, deps),
    ).toMatchObject({
      ok: false,
    })
  })

  it('resumes, pauses and runs a routine', async () => {
    const { home, deps } = await world()
    expect(
      await act({ t: 'routine', id: 'routine:daily-brief', do: 'resume' }, deps),
    ).toMatchObject({ ok: true })
    expect((await listRoutines(home))[0]?.enabled).toBe(true)
    expect(await act({ t: 'routine', id: 'daily-brief', do: 'run' }, deps)).toMatchObject({
      ok: true,
      text: 'Running daily-brief on pm.',
    })
    expect(await act({ t: 'routine', id: 'nope', do: 'run' }, deps)).toMatchObject({ ok: false })
  })
})
