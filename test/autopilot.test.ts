import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  autopilot,
  AUTOPILOT_START,
  BACKSTOP_MS,
  dispatchSignal,
  dueRoutines,
} from '../src/autopilot.ts'
import { OVERNIGHT_DEFAULTS, type Config } from '../src/config.ts'
import type { DispatchReport } from '../src/dispatch.ts'
import type { Draft } from '../src/drafts.ts'
import type { Item, Snapshot } from '../src/model.ts'
import { lastRun, type Routine, type Run } from '../src/routines/index.ts'

const brief: Routine = {
  name: 'daily-brief',
  project: 'meta/inbox',
  schedule: 'daily 7:00',
  enabled: true,
  prompt: 'Brief me.',
}
const at = (h: number, m = 0, day = 28) => new Date(2026, 8, day, h, m)
const run = (when: Date, status: Run['status'] = 'started'): Run => ({
  routine: 'daily-brief',
  at: when.getTime(),
  status,
  prompt: 'x',
})

describe('lastRun', () => {
  it('finds the latest time at or before now', () => {
    expect(lastRun('daily 7:00', at(9))?.getTime()).toBe(at(7).getTime())
    expect(lastRun('daily 7:00', at(6))?.getTime()).toBe(at(7, 0, 27).getTime())
    expect(lastRun('daily 7:00', at(7))?.getTime()).toBe(at(7).getTime())
    // Mon 28 Sept 2026: the last Saturday 6:00 was the 26th.
    expect(lastRun('weekly sat 6:00', at(9))?.getTime()).toBe(at(6, 0, 26).getTime())
    expect(lastRun('', at(9))).toBeNull()
  })
})

describe('dueRoutines', () => {
  it('runs a routine once after its time, catching up only within the hour', () => {
    expect(dueRoutines([brief], [], at(7, 1))).toEqual([brief])
    expect(dueRoutines([brief], [], at(7, 59))).toEqual([brief])
    expect(dueRoutines([brief], [], at(8, 1))).toEqual([]) // opened too late: wait for tomorrow
    expect(dueRoutines([brief], [run(at(7, 0))], at(7, 5))).toEqual([])
    expect(dueRoutines([brief], [run(at(6, 50), 'skipped')], at(7, 5))).toEqual([brief])
    expect(dueRoutines([brief], [run(at(7, 2), 'skipped')], at(7, 5))).toEqual([]) // skipped counts
    expect(dueRoutines([{ ...brief, enabled: false }], [], at(7, 1))).toEqual([])
    expect(dueRoutines([{ ...brief, schedule: '' }], [], at(7, 1))).toEqual([])
    // Tried by this app already (a run that failed before it recorded itself).
    expect(dueRoutines([brief], [], at(7, 5), { 'daily-brief': at(7, 1).getTime() })).toEqual([])
  })
})

const config = async (): Promise<Config> => ({
  path: '',
  accountsPath: '',
  home: await mkdtemp(join(tmpdir(), 'hopper-auto-')),
  accounts: [],
  routes: [],
  overnight: OVERNIGHT_DEFAULTS,
})

const snapshot = (fields: Partial<Snapshot> = {}): Snapshot => ({
  at: 0,
  drafts: [],
  routines: [],
  runs: [],
  reports: {},
  projects: [],
  projectsError: null,
  openCounts: new Map(),
  accounts: [],
  items: [],
  ...fields,
})

const queued: Draft = {
  id: 'a-1',
  project: 'meta/inbox',
  text: 'x',
  created: 0,
  updated: 0,
  queue: 'now',
}
const convo = (where: Item['where']) => ({ id: 'c1', where }) as Item

describe('dispatchSignal', () => {
  it('is null with nothing queued, and changes when a conversation moves or night falls', async () => {
    const c = await config()
    expect(dispatchSignal(snapshot(), c, at(12))).toBeNull()
    const s = (where: Item['where'], when: Date) =>
      dispatchSignal(snapshot({ drafts: [queued], items: [convo(where)] }), c, when)
    expect(s('queue', at(12))).toBe(s('queue', at(13)))
    expect(s('queue', at(12))).not.toBe(s('done', at(12)))
    expect(s('queue', at(12))).not.toBe(s('queue', at(23)))
  })
})

describe('autopilot', () => {
  const report: DispatchReport = { at: 0, night: false, started: [], waiting: [] }

  it('dispatches when something changes, and otherwise only every few minutes', async () => {
    const c = await config()
    let dispatched = 0
    const deps = {
      run: async () => ({ status: 'passed' as const }),
      dispatch: async () => {
        dispatched++
        return report
      },
    }
    const snap = snapshot({ drafts: [queued], items: [convo('queue')] })
    let state = AUTOPILOT_START
    const tick = async (s: Snapshot, now: Date) => {
      state = (await autopilot({ config: c, snap: s, now, state, deps })).state
    }
    await tick(snap, at(12))
    expect(dispatched).toBe(1)
    await tick(snap, at(12, 1)) // nothing changed
    expect(dispatched).toBe(1)
    await tick(snapshot({ drafts: [queued], items: [convo('done')] }), at(12, 2)) // it finished
    expect(dispatched).toBe(2)
    await tick(
      snapshot({ drafts: [queued], items: [convo('done')] }),
      new Date(at(12, 2).getTime() + BACKSTOP_MS),
    )
    expect(dispatched).toBe(3) // room on an account can change unseen
    await tick(snapshot(), at(13)) // nothing queued
    expect(dispatched).toBe(3)
  })

  it('runs a due routine once, even when running it fails', async () => {
    const c = await config()
    const ran: string[] = []
    const deps = {
      run: async (r: Routine) => {
        ran.push(r.name)
        throw new Error('untrusted folder')
      },
      dispatch: async () => report,
    }
    const snap = snapshot({ routines: [brief] })
    let state = AUTOPILOT_START
    for (const m of [1, 2, 3]) {
      const out = await autopilot({ config: c, snap, now: at(7, m), state, deps })
      state = out.state
      if (m === 1)
        expect(out.ran[0]?.outcome).toEqual({ status: 'skipped', reason: 'untrusted folder' })
    }
    expect(ran).toEqual(['daily-brief'])
  })
})
