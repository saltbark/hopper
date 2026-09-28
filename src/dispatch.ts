import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { readUsage, refreshUsage, UntrustedError, type Usage } from './claude.ts'
import { parseWindow, type Account, type Config } from './config.ts'
import { loadConversations, type ConversationMeta } from './conversations.ts'
import type { Draft } from './drafts.ts'
import { readIfThere, tryLock, writeJson } from './fsutil.ts'
import type { Project } from './home.ts'
import type { AccountState, Item } from './model.ts'
import { readResult } from './routines/index.ts'
import { hasRoom, routeFor } from './routing.ts'
import { startDraft } from './start.ts'

// Up next: drafts queued to start on their own. The open app (autopilot.ts), `g`, and
// `hopper dispatch` starts each one that is ready, on an account with room, within the night's
// budget. Everything it starts runs unattended.

// ---------- when a draft is ready ----------

export type Readiness = { ready: true } | { ready: false; reason: string }

// A draft named in `after:` is finished when its conversation is done (marked done, or finished
// with a result saying "needs: nothing"). One that needs me holds up everything after it.
export async function readiness(
  d: Draft,
  ctx: { drafts: Draft[]; meta: Record<string, ConversationMeta>; items: Item[] },
): Promise<Readiness> {
  for (const dep of d.after ?? []) {
    if (ctx.drafts.some((x) => x.id === dep))
      return { ready: false, reason: `waits for ${dep} to start` }
    // A dependency is named by its draft id, or by the conversation's short id.
    const id = ctx.meta[dep] ? dep : Object.entries(ctx.meta).find(([, m]) => m.draft === dep)?.[0]
    if (!id) return { ready: false, reason: `waits for ${dep}, which Hopper doesn't know` }
    const item = ctx.items.find((i) => i.id === id)
    if (item?.where === 'done') continue
    if (item?.where === 'queue') return { ready: false, reason: `waits for ${dep}, still running` }
    // Removed from Claude (claude rm): only its result can say how it ended.
    if (!item) {
      const result = await readResult(ctx.meta[id]?.result)
      if (result?.needs === 'nothing') continue
      return { ready: false, reason: `waits for ${dep}, which is gone without a clean result` }
    }
    return { ready: false, reason: `waits for ${dep}, which needs you` }
  }
  return { ready: true }
}

// ---------- the night ----------

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes()

export function inWindow(window: string, at: Date): boolean {
  const w = parseWindow(window)
  if (typeof w === 'string') return false
  const m = minutesOf(at)
  return w.from <= w.to ? m >= w.from && m < w.to : m >= w.from || m < w.to
}

// The night a time belongs to, named by the date it began: 02:00 on the 29th is the night of
// the 28th.
export function nightOf(window: string, at: Date): string {
  const w = parseWindow(window)
  const d = new Date(at)
  if (typeof w !== 'string' && w.from > w.to && minutesOf(at) < w.to) d.setDate(d.getDate() - 1)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Each account's weekly usage when the night began, so the budget is what the night spent.
type Night = { night: string; start: Record<string, number> }
const nightFile = (home: string) => join(home, 'state', 'night.json')

async function loadNight(home: string): Promise<Night | null> {
  try {
    const raw = JSON.parse((await readIfThere(nightFile(home))) ?? 'null') as Night | null
    return raw && typeof raw.night === 'string' ? raw : null
  } catch {
    return null
  }
}

// ---------- one pass ----------

export type Started = { draft: string; id: string; account: string; name: string }
export type Waiting = { draft: string; name: string; reason: string }
export type DispatchReport = { at: number; night: boolean; started: Started[]; waiting: Waiting[] }

const firstLine = (d: Draft) =>
  (d.text.split('\n').find((l) => l.trim()) ?? '(empty)').trim().slice(0, 60)

export type DispatchDeps = {
  // Fresh usage for an account; by default asks Claude (/usage is free) and reads the cache.
  usage?: (account: Account, cwd: string) => Promise<Usage | null>
  start?: typeof startDraft
}

async function freshUsage(account: Account, cwd: string): Promise<Usage | null> {
  await refreshUsage(account, cwd).catch(() => '')
  return readUsage(account)
}

export async function dispatch(opts: {
  config: Config
  drafts: Draft[]
  projects: Project[]
  accounts: AccountState[]
  items: Item[]
  now?: Date
  deps?: DispatchDeps
}): Promise<DispatchReport> {
  const { config, drafts, projects, items } = opts
  const home = config.home
  const at = opts.now ?? new Date()
  const { window, budget, reserve, maxRunning } = config.overnight
  const night = inWindow(window, at)
  const report: DispatchReport = { at: at.getTime(), night, started: [], waiting: [] }
  const queued = drafts.filter((d) => d.queue).sort((a, b) => a.created - b.created)
  if (!queued.length) return report

  // Only one at a time: two Hopper windows can both be open.
  const unlock = await tryLock(join(home, 'state', 'dispatch.lock'))
  if (!unlock) {
    for (const d of queued)
      report.waiting.push({
        draft: d.id,
        name: firstLine(d),
        reason: 'another dispatch is running',
      })
    return report
  }
  try {
    const meta = await loadConversations(home)
    const ready: Draft[] = []
    for (const d of queued) {
      const wait = (reason: string) =>
        report.waiting.push({ draft: d.id, name: firstLine(d), reason })
      if (d.queue === 'night' && !night) {
        wait(`starts in the night window (${window})`)
        continue
      }
      const r = await readiness(d, { drafts, meta, items })
      if (r.ready) ready.push(d)
      else wait(r.reason)
    }
    if (!ready.length) return report

    // Usage is a cache; before spending anything, ask for it fresh (free, answered locally).
    const usageOf = opts.deps?.usage ?? freshUsage
    const states = new Map<string, AccountState>()
    for (const s of opts.accounts) {
      const usage = s.auth?.loggedIn ? await usageOf(s.account, home) : s.usage
      states.set(s.account.name, { ...s, usage: usage ?? s.usage })
    }
    const week = (name: string) => states.get(name)?.usage?.sevenDay?.pct

    // The night's budget is measured from where each account stood when it began.
    // An account whose usage wasn't known then starts counting when it first is.
    let tonight = night ? await loadNight(home) : null
    if (night) {
      if (tonight?.night !== nightOf(window, at))
        tonight = { night: nightOf(window, at), start: {} }
      const missing = [...states.keys()].filter(
        (n) => tonight!.start[n] === undefined && week(n) !== undefined,
      )
      for (const n of missing) tonight.start[n] = week(n)!
      if (missing.length) await writeJson(nightFile(home), tonight)
    }

    const running = new Map<string, number>()
    for (const it of items) {
      if (it.where !== 'queue' || !it.id || !meta[it.id]?.unattended) continue
      running.set(it.account, (running.get(it.account) ?? 0) + 1)
    }

    const start = opts.deps?.start ?? startDraft
    for (const d of ready) {
      const wait = (reason: string) =>
        report.waiting.push({ draft: d.id, name: firstLine(d), reason })
      const project = projects.find((p) => p.key === d.project)
      if (!project) {
        wait(`no project ${d.project}`)
        continue
      }
      const route = routeFor(config, d.project)
      const only = !route && config.accounts.length === 1 ? config.accounts[0] : undefined
      const names = route?.accounts ?? (only ? [only.name] : [])
      if (!names.length) {
        wait(`no account runs ${d.project}`)
        continue
      }
      // The first account on the route that is signed in, has room, isn't already running its
      // share, and is inside the reserve (and, at night, the night's budget).
      const refusal = (a: Account): string | null => {
        const pct = week(a.name)
        const from = tonight?.start[a.name]
        if (!hasRoom(states.get(a.name))) return `${a.name} full or signed out`
        if ((running.get(a.name) ?? 0) >= maxRunning) return `${a.name} already runs ${maxRunning}`
        if (pct !== undefined && pct >= 100 - reserve)
          return `${a.name} is into the reserve (${pct}% of the week)`
        if (night && pct !== undefined && from !== undefined && pct - from >= budget)
          return `${a.name} spent tonight's budget (${pct - from} points)`
        return null
      }
      const why: string[] = []
      let account: Account | undefined
      for (const n of names) {
        const a = config.accounts.find((x) => x.name === n)
        const no = a ? refusal(a) : `no account ${n}`
        if (a && !no) {
          account = a
          break
        }
        if (no) why.push(no)
      }
      if (!account) {
        wait(why.join('; '))
        continue
      }
      try {
        const out = await start({ config, project, account, draft: d, unattended: true })
        running.set(account.name, (running.get(account.name) ?? 0) + 1)
        report.started.push({ draft: d.id, id: out.id, account: account.name, name: out.name })
      } catch (e) {
        wait(
          e instanceof UntrustedError
            ? `Claude doesn't trust ${e.dir} yet; start one conversation there from Hopper first`
            : (e as Error).message,
        )
      }
    }
    return report
  } finally {
    await unlock()
  }
}

// What the last pass did, for `hopper list` and the app to say why things wait; and a log of
// every pass that started something, so the morning can see what the night did.
export async function recordDispatch(home: string, report: DispatchReport): Promise<void> {
  await writeJson(join(home, 'state', 'dispatch.json'), report)
  if (!report.started.length) return
  await mkdir(join(home, 'state'), { recursive: true })
  await appendFile(join(home, 'state', 'dispatch.jsonl'), JSON.stringify(report) + '\n')
}

export async function lastDispatch(home: string): Promise<DispatchReport | null> {
  try {
    return JSON.parse((await readIfThere(join(home, 'state', 'dispatch.json'))) ?? 'null')
  } catch {
    return null
  }
}
