import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { addAccount, OVERNIGHT_DEFAULTS, setDefaultAccount, type Config } from '../src/config.ts'
import { loadConversations } from '../src/conversations.ts'
import type { AccountState } from '../src/model.ts'
import {
  listRoutines,
  listRuns,
  nextRun,
  parseRoutine,
  parseSchedule,
  plistFor,
  readResult,
  runRoutine,
  saveRoutine,
  serializeRoutine,
  syncLaunchd,
  type Routine,
} from '../src/routines/index.ts'
import { fakeClaude } from './helpers.ts'

const triage: Routine = {
  name: 'inbox-triage',
  project: 'meta/inbox',
  schedule: 'weekdays 7:00, 13:00',
  model: 'haiku',
  enabled: true,
  prompt: 'Triage the inbox.\n\nNever send anything.',
}

describe('routine files', () => {
  it('round-trip', () => {
    expect(parseRoutine('inbox-triage', serializeRoutine(triage))).toEqual(triage)
  })
  it('save, list, and refuse a bad schedule or name', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-rt-'))
    await saveRoutine(home, triage)
    expect((await listRoutines(home)).map((r) => r.name)).toEqual(['inbox-triage'])
    await expect(saveRoutine(home, { ...triage, schedule: 'sometimes' })).rejects.toThrow(
      /give a time/,
    )
    await expect(saveRoutine(home, { ...triage, name: 'Bad Name' })).rejects.toThrow(/lowercase/)
  })
})

describe('schedules', () => {
  it('read the forms people write', () => {
    expect(parseSchedule('daily 7:00')).toEqual([{ hour: 7, minute: 0 }])
    expect(parseSchedule('weekdays 7:00, 13:30')).toHaveLength(10)
    expect(parseSchedule('weekly mon 9:00')).toEqual([{ hour: 9, minute: 0, weekday: 1 }])
    expect(parseSchedule('mon,wed,fri 9:00')).toHaveLength(3)
    expect(parseSchedule('monthly 1st 9:00')).toEqual([{ hour: 9, minute: 0, day: 1 }])
    expect(parseSchedule('daily 4pm')).toMatch(/give a time/) // needs minutes
    expect(parseSchedule('daily 4:15pm')).toEqual([{ hour: 16, minute: 15 }])
    expect(parseSchedule('')).toEqual([])
    expect(parseSchedule('fortnightly 9:00')).toMatch(/try daily/)
  })
  it('know when they next run', () => {
    const fri = new Date(2026, 8, 25, 14, 0) // Fri 25 Sept 2026, 14:00
    expect(nextRun('weekdays 7:00, 13:00', fri)?.toString()).toBe(
      new Date(2026, 8, 28, 7, 0).toString(),
    )
    expect(nextRun('daily 23:00', fri)?.toString()).toBe(new Date(2026, 8, 25, 23, 0).toString())
    expect(nextRun('monthly 1st 9:00', fri)?.toString()).toBe(new Date(2026, 9, 1, 9, 0).toString())
    expect(nextRun('', fri)).toBeNull()
  })
})

describe('results', () => {
  it('read whether a run needs you and its summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hopper-res-'))
    const a = join(dir, 'a.md')
    await writeFile(a, 'needs: nothing\nNothing new since yesterday.\n\nDetail…\n')
    expect(await readResult(a)).toEqual({
      needs: 'nothing',
      summary: 'Nothing new since yesterday.',
    })
    const b = join(dir, 'b.md')
    await writeFile(b, '---\nneeds: you\n---\n# Inbox\n3 replies drafted for you to check.\n')
    expect(await readResult(b)).toEqual({
      needs: 'you',
      summary: '3 replies drafted for you to check.',
    })
    expect(await readResult(join(dir, 'missing.md'))).toBeNull()
  })
})

describe('launchd', () => {
  const opts = {
    node: '/usr/local/bin/node',
    hopper: '/x/bin/hopper.js',
    configPath: '/c/config.toml',
    logDir: '/h/state/logs',
    path: '/usr/bin',
  }
  it('makes one calendar entry per time, and none for a paused or unscheduled routine', () => {
    const xml = plistFor({ ...triage, schedule: 'weekly mon 9:30' }, opts)!
    expect(xml).toContain('<string>com.saltbark.hopper.inbox-triage</string>')
    expect(xml).toContain('<string>run</string>\n    <string>inbox-triage</string>')
    expect(xml).toContain('<key>Hour</key><integer>9</integer>')
    expect(xml).toContain('<key>Minute</key><integer>30</integer>')
    expect(xml).toContain('<key>Weekday</key><integer>1</integer>')
    expect(plistFor({ ...triage, enabled: false }, opts)).toBeNull()
    expect(plistFor({ ...triage, schedule: '' }, opts)).toBeNull()
  })
  it('sync writes, rewrites and removes entries to match the routines', async () => {
    const agents = await mkdtemp(join(tmpdir(), 'hopper-agents-'))
    const home = await mkdtemp(join(tmpdir(), 'hopper-home-'))
    process.env['HOPPER_LAUNCHD_DIR'] = agents
    process.env['HOPPER_NO_LAUNCHCTL'] = '1'
    const config = {
      path: '/c/config.toml',
      accountsPath: '',
      home,
      accounts: [],
      routes: [],
      overnight: OVERNIGHT_DEFAULTS,
    } as Config
    expect(await syncLaunchd(config, [triage], { hopper: '/x/hopper.js' })).toEqual({
      loaded: ['inbox-triage'],
      removed: [],
    })
    expect(await syncLaunchd(config, [triage], { hopper: '/x/hopper.js' })).toEqual({
      loaded: [],
      removed: [],
    })
    expect(
      await syncLaunchd(config, [{ ...triage, enabled: false }], { hopper: '/x/hopper.js' }),
    ).toEqual({ loaded: [], removed: ['inbox-triage'] })
    expect(await readdir(agents)).toEqual([])
    delete process.env['HOPPER_LAUNCHD_DIR']
    delete process.env['HOPPER_NO_LAUNCHCTL']
  })
})

describe('runRoutine', () => {
  const setup = async () => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-run-'))
    const log = join(home, 'calls.log')
    const bin = await fakeClaude(
      `echo "$*" >> "${log}"\necho "backgrounded · a1b2c3d4 · name"`,
      home,
    )
    process.env['HOPPER_CLAUDE'] = bin
    let config: Config = {
      path: '',
      accountsPath: '',
      home,
      accounts: [],
      routes: [],
      overnight: OVERNIGHT_DEFAULTS,
    }
    config = setDefaultAccount(
      addAccount(config, { name: 'kf', label: 'kf', configDir: null }),
      'kf',
    )
    const state = (pct: number): AccountState => ({
      account: config.accounts[0]!,
      auth: { loggedIn: true },
      authError: null,
      usage: {
        fiveHour: { pct, resetsAt: new Date(Date.now() + 3_600_000).toISOString() },
        sevenDay: null,
        fetchedAt: Date.now(),
      },
      sessionError: null,
      counts: { queue: 0, needs: 0, done: 0, live: 0 },
    })
    const projects = [
      {
        key: 'meta/inbox',
        path: home,
        runIn: home,
        openFile: join(home, '_open.md'),
        model: 'sonnet',
      },
    ]
    return { home, log, config, state, projects }
  }

  it('starts a conversation with the routine’s model, and records the run and the model', async () => {
    const { home, log, config, state, projects } = await setup()
    const out = await runRoutine({
      config,
      routine: triage,
      projects,
      accounts: [state(20)],
      sessions: [],
      systemPrompt: () => 'P.',
    })
    expect(out).toEqual({ status: 'started', id: 'a1b2c3d4', account: 'kf' })
    const call = await readFile(log, 'utf8')
    expect(call).toContain('--bg --name ↻ inbox-triage')
    expect(call).toContain('--model haiku') // the routine's model beats the project's
    expect(call).toMatch(/--add-dir \S*\/routines --/)
    expect(call).toContain('a scheduled run of the Hopper routine "inbox-triage"')
    const [run] = await listRuns(home, 'inbox-triage')
    expect(run).toMatchObject({ status: 'started', id: 'a1b2c3d4', account: 'kf', model: 'haiku' })
    expect(run?.result).toMatch(/routines\/inbox-triage\/runs\/.*\.md$/)
    expect((await loadConversations(home))['a1b2c3d4']).toMatchObject({ routine: 'inbox-triage' })
    delete process.env['HOPPER_CLAUDE']
  })

  it('skips when every account is full, and when the previous run is still going', async () => {
    const { home, log, config, state, projects } = await setup()
    expect(
      await runRoutine({
        config,
        routine: triage,
        projects,
        accounts: [state(95)],
        sessions: [],
        systemPrompt: () => '',
      }),
    ).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/full/) })
    await runRoutine({
      config,
      routine: triage,
      projects,
      accounts: [state(10)],
      sessions: [],
      systemPrompt: () => '',
    })
    const again = await runRoutine({
      config,
      routine: triage,
      projects,
      accounts: [state(10)],
      sessions: [{ id: 'a1b2c3d4', state: 'working' }],
      systemPrompt: () => '',
    })
    expect(again).toMatchObject({ status: 'skipped', reason: 'the previous run is still going' })
    expect((await listRuns(home)).map((r) => r.status)).toEqual(['skipped', 'started', 'skipped'])
    expect(
      (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .filter((l) => l.startsWith('--bg')),
    ).toHaveLength(1)
    delete process.env['HOPPER_CLAUDE']
  })
})

describe('runs in the list', () => {
  it('a finished run that needs nothing goes straight to Done; one that needs you waits', async () => {
    const { gather } = await import('../src/model.ts')
    const { initHome } = await import('../src/home.ts')
    const home = await mkdtemp(join(tmpdir(), 'hopper-auto-'))
    await initHome(home)
    const inbox = join(home, 'projects', 'meta', 'inbox')
    // Two finished runs of one routine: one said nothing needs me, one said something does.
    const bin = join(home, 'claude')
    const sessions = [
      {
        id: 'aaaa1111',
        cwd: inbox,
        kind: 'background',
        startedAt: 1,
        sessionId: 's-1',
        name: 'run 1',
        state: 'done',
      },
      {
        id: 'bbbb2222',
        cwd: inbox,
        kind: 'background',
        startedAt: 2,
        sessionId: 's-2',
        name: 'run 2',
        state: 'done',
      },
    ]
    await fakeClaude(
      `case "$1" in auth) echo '{"loggedIn":true}';; agents) echo '${JSON.stringify(sessions)}';; esac`,
      dirname(bin),
    )
    process.env['HOPPER_CLAUDE'] = bin
    await saveRoutine(home, { ...triage, schedule: '' })
    const { recordConversation } = await import('../src/conversations.ts')
    await recordConversation(home, 'aaaa1111', {
      project: 'meta/inbox',
      routine: 'inbox-triage',
      startedAt: 1,
    })
    await recordConversation(home, 'bbbb2222', {
      project: 'meta/inbox',
      routine: 'inbox-triage',
      startedAt: 2,
    })
    const r1 = join(home, 'r1.md')
    const r2 = join(home, 'r2.md')
    await writeFile(r1, 'needs: nothing\nAll quiet.\n')
    await writeFile(r2, 'needs: you\n2 replies to check.\n')
    await mkdir(join(home, 'state'), { recursive: true })
    await writeFile(
      join(home, 'state', 'runs.jsonl'),
      [
        {
          routine: 'inbox-triage',
          at: 1,
          status: 'started',
          id: 'aaaa1111',
          result: r1,
          prompt: 'x',
        },
        {
          routine: 'inbox-triage',
          at: 2,
          status: 'started',
          id: 'bbbb2222',
          result: r2,
          prompt: 'x',
        },
      ]
        .map((x) => JSON.stringify(x))
        .join('\n') + '\n',
    )
    let config: Config = {
      path: join(home, 'c.toml'),
      accountsPath: '',
      home,
      accounts: [],
      routes: [],
      overnight: OVERNIGHT_DEFAULTS,
    }
    config = addAccount(config, { name: 'kf', label: 'kf', configDir: null })
    const snap = await gather(config, null, true)
    const where = (id: string) => snap.items.find((i) => i.id === id)?.where
    expect(where('aaaa1111')).toBe('done')
    expect(where('bbbb2222')).toBe('needs')
    expect(snap.items.find((i) => i.id === 'bbbb2222')?.result).toEqual({
      needs: 'you',
      summary: '2 replies to check.',
    })
    expect(snap.items.find((i) => i.kind === 'routine')).toMatchObject({
      name: 'inbox-triage',
      where: 'routine',
      state: 'manual',
    })
    delete process.env['HOPPER_CLAUDE']
  })
})
