import { join } from 'node:path'

import type { Config } from './config.ts'
import { inWindow, type DispatchReport } from './dispatch.ts'
import { tryLock } from './fsutil.ts'
import type { Snapshot } from './model.ts'
import { lastRun, listRuns, type Routine, type RunOutcome, type Run } from './routines/index.ts'

// What the open app does on its own: runs routines when they're due and starts queued drafts as
// they become ready. With Hopper closed, nothing runs. App calls `autopilot` after every poll
// (about every five seconds), so it has to be cheap when there's nothing to do.

// A routine whose time came while Hopper was closed still runs if Hopper opens within this;
// later than that, it waits for its next time. An evening routine shouldn't fire next morning.
export const CATCH_UP_MS = 60 * 60_000

// Dispatch runs when something that could make queued work ready changes. Room on an account
// is the one thing polling doesn't see change, so it also runs this often while work is queued.
export const BACKSTOP_MS = 5 * 60_000

// The routines to run now: on, scheduled, their latest time passed within CATCH_UP_MS, and no
// run (of any kind: started, skipped, passed, run by hand) since that time.
// `tried` is when this app last tried each, for a run that failed before it could record itself.
export function dueRoutines(
  routines: Routine[],
  runs: Run[],
  now: Date,
  tried: Record<string, number> = {},
): Routine[] {
  return routines.filter((r) => {
    if (!r.enabled || !r.schedule) return false
    const slot = lastRun(r.schedule, now)?.getTime()
    if (slot === undefined || now.getTime() - slot > CATCH_UP_MS) return false
    if ((tried[r.name] ?? 0) >= slot) return false
    return !runs.some((x) => x.routine === r.name && x.at >= slot)
  })
}

// Everything that can make a queued draft ready, as one string: the queued drafts, where each
// conversation is (one finishing can free what waits on it), and whether it's night. Null when
// nothing is queued, so there is nothing to dispatch.
export function dispatchSignal(snap: Snapshot, config: Config, now: Date): string | null {
  const queued = snap.drafts.filter((d) => d.queue)
  if (!queued.length) return null
  const parts = queued.map((d) => `d:${d.id}:${d.queue}:${(d.after ?? []).join(',')}`)
  for (const it of snap.items) if (it.id) parts.push(`c:${it.id}:${it.where}`)
  parts.push(inWindow(config.overnight.window, now) ? 'night' : 'day')
  return parts.sort().join('|')
}

export type AutopilotState = {
  signal: string | null
  dispatchedAt: number
  tried: Record<string, number>
}
export const AUTOPILOT_START: AutopilotState = { signal: null, dispatchedAt: 0, tried: {} }

export type AutopilotDeps = {
  run: (r: Routine) => Promise<RunOutcome>
  dispatch: () => Promise<DispatchReport>
}

export type AutopilotOutcome = {
  state: AutopilotState
  ran: { routine: string; outcome: RunOutcome }[]
  report: DispatchReport | null
}

export async function autopilot(opts: {
  config: Config
  snap: Snapshot
  now: Date
  state: AutopilotState
  deps: AutopilotDeps
}): Promise<AutopilotOutcome> {
  const { config, snap, now, deps } = opts
  const ran: AutopilotOutcome['ran'] = []
  let state = opts.state

  if (dueRoutines(snap.routines, snap.runs, now, state.tried).length) {
    // Two Hopper windows would both see the routine due: the lock and a fresh read of the run
    // log make sure only one runs it.
    const unlock = await tryLock(join(config.home, 'state', 'routines.lock'))
    if (unlock) {
      try {
        const runs = await listRuns(config.home)
        for (const r of dueRoutines(snap.routines, runs, now, state.tried)) {
          state = { ...state, tried: { ...state.tried, [r.name]: now.getTime() } }
          const outcome = await deps
            .run(r)
            .catch((e: Error): RunOutcome => ({ status: 'skipped', reason: e.message }))
          ran.push({ routine: r.name, outcome })
        }
      } finally {
        await unlock()
      }
    }
  }

  let report: DispatchReport | null = null
  const signal = dispatchSignal(snap, config, now)
  const stale = now.getTime() - state.dispatchedAt >= BACKSTOP_MS
  if (signal && (signal !== state.signal || stale)) {
    report = await deps.dispatch()
    state = { ...state, signal, dispatchedAt: now.getTime() }
  } else if (!signal) state = { ...state, signal: null }
  return { state, ran, report }
}
