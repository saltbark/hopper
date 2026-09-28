import {
  fetchAuth,
  fetchSessions,
  readUsage,
  type Auth,
  type Session,
  type Usage,
} from './claude.ts'
import type { Account, Config } from './config.ts'
import { loadConversations } from './conversations.ts'
import { inWindow, readiness } from './dispatch.ts'
import { loadDone } from './done.ts'
import { listDrafts, type Draft } from './drafts.ts'
import { loadProjects, readOpenCount, type Project } from './home.ts'
import { isWithin } from './paths.ts'
import {
  listReports,
  listRoutines,
  listRuns,
  nextRun,
  readResult,
  type Report,
  type Result,
  type Routine,
  type Run,
} from './routines/index.ts'
import { pickAccount } from './routing.ts'
import { loadSeen } from './seen.ts'

// Sessions whose cwd is under no project are grouped here, so outside work still shows.
// The leading ~ sorts it after every real key in the tree.
export const OTHER = '~elsewhere'

// 'filed' is a routine's run once it has finished: it lives in its routine's reports, not in
// the list or Done.
export type Where = 'queue' | 'needs' | 'done' | 'live' | 'routine' | 'filed'

// The queue is what's running. Everything else waits on me in Needs you (Claude's "done" means
// it answered and is waiting) until I mark it done. Interactive terminals belong to neither.
const WAITING = new Set(['blocked', 'done', 'failed', 'stopped'])

export function classify(s: Session, done: Set<string> = new Set()): Where {
  if (s.kind === 'interactive') return 'live'
  if (s.kind === 'routine') return 'routine'
  if (done.has(s.sessionId)) return 'done'
  if (s.kind === 'draft') return 'needs'
  if (WAITING.has(s.state)) return 'needs'
  return 'queue'
}

export function projectForCwd(projects: Project[], cwd: string): Project | undefined {
  let best: Project | undefined
  for (const p of projects) {
    if (isWithin(cwd, p.path) && (!best || p.path.length > best.path.length)) best = p
  }
  return best
}

export type Item = Session & {
  where: Where
  key: string
  // Recorded by Hopper when it started the conversation.
  model?: string
  effort?: string
  routine?: string
  // For a routine's run or an unattended conversation: what its result file says.
  result?: Result | null
  resultPath?: string
  // Started with nobody watching.
  unattended?: boolean
  // For a routine: its newest report says it needs me, and I haven't opened its reports since.
  attention?: boolean
  // The draft a conversation started from; for a draft, its own id.
  draft?: string
  // A draft's overnight fields (drafts.ts).
  queue?: Draft['queue']
  after?: string[]
  done?: string
  proposed?: string
  // For a queued draft: why it hasn't started, or undefined when it's ready.
  waiting?: string
}

export type AccountState = {
  account: Account
  auth: Auth | null
  authError: string | null
  usage: Usage | null
  sessionError: string | null
  counts: { queue: number; needs: number; done: number; live: number }
}

export type Snapshot = {
  at: number
  drafts: Draft[]
  routines: Routine[]
  runs: Run[]
  // Each routine's reports, by routine name, newest first.
  reports: Record<string, Report[]>
  projects: Project[]
  projectsError: string | null
  openCounts: Map<string, number | null>
  accounts: AccountState[]
  items: Item[]
}

export function toItems(
  sessions: Session[],
  projects: Project[],
  done: Set<string> = new Set(),
): Item[] {
  return sessions
    .map((s) => ({
      ...s,
      where: classify(s, done),
      key: projectForCwd(projects, s.cwd)?.key ?? OTHER,
    }))
    .sort((a, b) => b.startedAt - a.startedAt)
}

// A draft shows alongside conversations, as one that hasn't started. Its session id is
// namespaced so it can be marked done like any other.
export const draftSessionId = (id: string) => `draft:${id}`
export const routineSessionId = (name: string) => `routine:${name}`

export function draftSession(d: Draft, projects: Project[], account: string): Session {
  const firstLine = d.text.split('\n').find((l) => l.trim()) ?? '(empty draft)'
  return {
    account,
    id: null,
    sessionId: draftSessionId(d.id),
    kind: 'draft',
    cwd: projects.find((p) => p.key === d.project)?.path ?? '',
    name: firstLine.trim(),
    startedAt: d.updated,
    state: 'draft',
  }
}

export function inScope(key: string, scope: string | null): boolean {
  if (!scope) return true
  return key === scope || key.startsWith(scope + '/')
}

// Auth changes rarely and costs a process per login, so callers pass the last result and
// only re-fetch it when asked.
export async function gather(
  config: Config,
  previous: Snapshot | null,
  withAuth: boolean,
): Promise<Snapshot> {
  let projects: Project[] = []
  let projectsError: string | null = null
  try {
    projects = await loadProjects(config.home)
  } catch (e) {
    projectsError =
      (e as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'no projects.toml; run hopper init'
        : (e as Error).message
  }
  const openCounts = new Map<string, number | null>()
  await Promise.all(projects.map(async (p) => openCounts.set(p.key, await readOpenCount(p))))

  const perAccount = await Promise.all(
    config.accounts.map(async (account) => {
      const prev = previous?.accounts.find((a) => a.account.name === account.name)
      let auth = prev?.auth ?? null
      let authError = prev?.authError ?? null
      if (withAuth || !prev) {
        try {
          auth = await fetchAuth(account)
          authError = null
        } catch (e) {
          authError = (e as Error).message
        }
      }
      let sessions: Session[] = []
      let sessionError: string | null = null
      try {
        sessions = await fetchSessions(account)
      } catch (e) {
        sessionError = (e as Error).message
      }
      return { account, auth, authError, usage: await readUsage(account), sessionError, sessions }
    }),
  )

  const drafts = await listDrafts(config.home)
  const routines = await listRoutines(config.home)
  const runs = await listRuns(config.home)
  const states = perAccount.map(({ sessions: _s, ...a }) => ({
    ...a,
    counts: { queue: 0, needs: 0, done: 0, live: 0 },
  }))
  const draftSessions = drafts.map((d) =>
    draftSession(d, projects, pickAccount(config, d.project, states).account?.name ?? '–'),
  )
  const now = new Date()
  const routineSessions: Session[] = routines.map((r) => ({
    account: pickAccount(config, r.project, states).account?.name ?? '–',
    id: null,
    sessionId: routineSessionId(r.name),
    kind: 'routine',
    cwd: projects.find((p) => p.key === r.project)?.path ?? '',
    name: r.name,
    // When it next runs, so the list can say so; 0 for paused or run-now-only routines.
    startedAt: r.enabled ? (nextRun(r.schedule, now)?.getTime() ?? 0) : 0,
    state: r.enabled ? (r.schedule ? 'scheduled' : 'manual') : 'paused',
  }))
  const items = toItems(
    [...perAccount.flatMap((a) => a.sessions), ...draftSessions, ...routineSessions],
    projects,
    await loadDone(config.home),
  )
  for (const it of items) {
    if (it.kind === 'routine') {
      it.key = routines.find((r) => routineSessionId(r.name) === it.sessionId)?.project ?? it.key
    }
  }
  const meta = await loadConversations(config.home)
  for (const it of items) {
    const m = it.id ? meta[it.id] : undefined
    if (m?.model) it.model = m.model
    if (m?.effort) it.effort = m.effort
    if (m?.routine) it.routine = m.routine
    if (m?.draft) it.draft = m.draft
    if (m?.unattended) it.unattended = true
    if (m?.result) it.resultPath = m.result
    // Several projects can run from one folder (a meta repo), so the folder alone can't say
    // which a conversation is for; the project Hopper started it in can.
    if (m?.project && projects.some((p) => p.key === m.project)) it.key = m.project
  }
  const reports: Record<string, Report[]> = {}
  for (const r of routines) reports[r.name] = await listReports(config.home, r.name, runs)
  // An unattended conversation that finished and says nothing needs me goes straight to Done.
  // A routine's run shows while it works; once finished it is filed with its routine's reports,
  // which say whether it needs me. Only a run blocked on a question stays in the list, because
  // the conversation is the one place to answer it.
  for (const it of items) {
    if (!it.id || (!it.routine && !it.resultPath)) continue
    const path = it.resultPath ?? runs.find((r) => r.id === it.id)?.result
    const listed = path && it.routine ? reports[it.routine]?.find((x) => x.path === path) : null
    it.result = listed ?? (path ? await readResult(path) : null)
    if (path && !it.resultPath) it.resultPath = path
    if (it.routine) {
      if (it.where === 'done' || (it.where === 'needs' && it.state !== 'blocked'))
        it.where = 'filed'
    } else if (it.where === 'needs' && it.state === 'done' && it.result?.needs === 'nothing')
      it.where = 'done'
  }
  const seen = await loadSeen(config.home)
  for (const it of items) {
    if (it.kind !== 'routine') continue
    const name = routines.find((r) => routineSessionId(r.name) === it.sessionId)?.name
    const latest = name ? reports[name]?.[0] : undefined
    if (name && latest?.needs === 'you' && seen[name] !== latest.path) it.attention = true
  }
  for (const d of drafts) {
    const it = items.find((x) => x.sessionId === draftSessionId(d.id))
    if (!it) continue
    it.draft = d.id
    if (d.model) it.model = d.model
    if (d.effort) it.effort = d.effort
    if (d.queue) {
      it.queue = d.queue
      it.state = d.queue === 'night' ? 'tonight' : 'queued'
      const r = await readiness(d, { drafts, meta, items })
      if (!r.ready) it.waiting = r.reason
      else if (d.queue === 'night' && !inWindow(config.overnight.window, now))
        it.waiting = `starts in the night window (${config.overnight.window})`
    }
    if (d.after) it.after = d.after
    if (d.done) it.done = d.done
    if (d.proposed) it.proposed = d.proposed
  }
  // A draft's project comes from the draft, not from matching its folder.
  for (const it of items)
    if (it.kind === 'draft')
      it.key = drafts.find((d) => draftSessionId(d.id) === it.sessionId)?.project ?? it.key
  const accounts: AccountState[] = perAccount.map(({ sessions: _s, ...a }) => {
    const mine = items.filter((i) => i.account === a.account.name)
    const n = (w: Where) => mine.filter((i) => i.where === w).length
    return {
      ...a,
      counts: { queue: n('queue'), needs: n('needs'), done: n('done'), live: n('live') },
    }
  })
  return {
    at: Date.now(),
    drafts,
    routines,
    runs,
    reports,
    projects,
    projectsError,
    openCounts,
    accounts,
    items,
  }
}
