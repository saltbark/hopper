import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { startBackground, type Session } from '../claude.ts'
import type { Config } from '../config.ts'
import { recordConversation } from '../conversations.ts'
import { readIfThere } from '../fsutil.ts'
import { extraDirs, type Project } from '../home.ts'
import type { AccountState } from '../model.ts'
import { hasRoom, routeFor } from '../routing.ts'
import { routinesDir, type Routine } from './files.ts'

export type Run = {
  routine: string
  at: number
  status: 'started' | 'skipped'
  reason?: string
  id?: string // the conversation's short id
  account?: string
  model?: string
  result?: string // where the run writes its result
  prompt: string // a short hash of the prompt it ran, to compare runs across tweaks
}

const runsFile = (home: string) => join(home, 'state', 'runs.jsonl')

export async function listRuns(home: string, routine?: string): Promise<Run[]> {
  const text = (await readIfThere(runsFile(home)).catch(() => null)) ?? ''
  if (!text) return []
  const runs: Run[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line) as Run
      if (!routine || r.routine === routine) runs.push(r)
    } catch {
      // a line cut short by a crash; skip it
    }
  }
  // Newest first; runs recorded in the same millisecond keep the order they were written.
  return runs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.at - a.r.at || b.i - a.i)
    .map((x) => x.r)
}

async function recordRun(home: string, run: Run): Promise<void> {
  await mkdir(join(home, 'state'), { recursive: true })
  await appendFile(runsFile(home), JSON.stringify(run) + '\n')
}

export const promptHash = (prompt: string) =>
  createHash('sha256').update(prompt).digest('hex').slice(0, 8)

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export const resultPath = (home: string, name: string, at: Date) =>
  join(routinesDir(home), name, 'runs', `${stamp(at)}.md`)

export type Result = { needs: 'you' | 'nothing' | null; summary: string }

// A run's result file: "needs: you" or "needs: nothing" on its first lines, then a summary.
export async function readResult(path: string | undefined): Promise<Result | null> {
  if (!path) return null
  const text = await readIfThere(path).catch(() => null)
  if (text === null) return null
  const needs = /^\s*(?:---\s*\n)?\s*needs:\s*(you|nothing)\b/im.exec(text)?.[1] as
    | Result['needs']
    | undefined
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\s*needs:.*$/im, '')
  const summary =
    body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#')) ?? ''
  return { needs: needs ?? null, summary }
}

// A report a routine left in its runs folder, with the run that wrote it when Hopper started
// that run (a report written by hand, or by a run no longer in the log, has none).
export type Report = Result & {
  path: string
  at: number
  id?: string | undefined // the conversation that wrote it
  account?: string | undefined
}

// The stamp resultPath writes, back to a time.
const unstamp = (file: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/.exec(file)
  return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!).getTime() : null
}

export const REPORTS_KEPT = 50

// A routine's reports, newest first, up to REPORTS_KEPT. The files are the list rather than the
// run log, so a report from a routine run some other way shows too.
export async function listReports(home: string, name: string, runs: Run[]): Promise<Report[]> {
  const dir = join(routinesDir(home), name, 'runs')
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.md'))
  const dated = await Promise.all(
    files.map(async (f) => {
      const path = join(dir, f)
      return { path, at: unstamp(f) ?? (await stat(path).catch(() => null))?.mtimeMs ?? 0 }
    }),
  )
  dated.sort((a, b) => b.at - a.at || b.path.localeCompare(a.path))
  return Promise.all(
    dated.slice(0, REPORTS_KEPT).map(async ({ path, at }) => {
      const run = runs.find((r) => r.result === path)
      const result = (await readResult(path)) ?? { needs: null, summary: '' }
      return { ...result, path, at, id: run?.id, account: run?.account }
    }),
  )
}

// What a run is told on top of the project prompt: where its result goes and what to put there.
export function routineInstructions(r: Routine, result: string, previous?: string): string {
  return [
    `This conversation is a scheduled run of the Hopper routine "${r.name}".`,
    'Do what the prompt asks, then write a short result to',
    `${result} (create the folder if needed). Its first line must be exactly "needs: you" if`,
    'anything is waiting on the person (a decision, a review, something to send), or',
    '"needs: nothing" if not. Then a one-line summary, then any detail.',
    previous ? `The previous run's result is at ${previous}; read it for continuity.` : '',
    'Never send, publish or push anything yourself: leave drafts for the person to approve.',
  ]
    .filter(Boolean)
    .join(' ')
}

export type RunOutcome =
  | { status: 'started'; id: string; account: string }
  | { status: 'skipped'; reason: string }

// One run: pick an account with room (skip if none), start the conversation in the project's
// folder, and record it. Called by `hopper run` (from launchd) and by run-now in the app.
export async function runRoutine(opts: {
  config: Config
  routine: Routine
  projects: Project[]
  accounts: AccountState[]
  sessions: Pick<Session, 'id' | 'state'>[]
  systemPrompt: (project: Project) => string
  now?: Date
}): Promise<RunOutcome> {
  const { config, routine: r, projects, accounts, sessions } = opts
  const at = opts.now ?? new Date()
  const home = config.home
  const skip = async (reason: string): Promise<RunOutcome> => {
    await recordRun(home, {
      routine: r.name,
      at: at.getTime(),
      status: 'skipped',
      reason,
      prompt: promptHash(r.prompt),
    })
    return { status: 'skipped', reason }
  }
  const project = projects.find((p) => p.key === r.project)
  if (!project) return skip(`no project ${r.project}`)
  const previous = (await listRuns(home, r.name)).find((x) => x.status === 'started')
  if (previous?.id && sessions.find((s) => s.id === previous.id)?.state === 'working') {
    return skip('the previous run is still going')
  }
  // Skip rather than start on an account that is near its limit.
  const route = routeFor(config, r.project)
  const only = !route && config.accounts.length === 1 ? config.accounts[0] : undefined
  const names = route?.accounts ?? (only ? [only.name] : [])
  const account = names
    .map((n) => config.accounts.find((a) => a.name === n))
    .find((a) => a && hasRoom(accounts.find((s) => s.account.name === a.name)))
  if (!account)
    return skip(
      names.length
        ? `every account for ${r.project} is full or signed out`
        : `no account runs ${r.project}`,
    )

  const result = resultPath(home, r.name, at)
  await mkdir(join(routinesDir(home), r.name, 'runs'), { recursive: true })
  const model = r.model ?? project.model
  const effort = r.effort ?? project.effort
  const when = at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const name = `↻ ${r.name} · ${when} ${at.toTimeString().slice(0, 5)}`
  const id = await startBackground(account, {
    cwd: project.runIn,
    name,
    prompt: r.prompt,
    systemPrompt: `${opts.systemPrompt(project)} ${routineInstructions(r, result, previous?.result)}`,
    model,
    effort,
    // The result file sits outside the project; let the run write there without asking.
    addDirs: [join(routinesDir(home), r.name), ...extraDirs(project)],
  })
  await recordConversation(home, id, {
    project: project.key,
    routine: r.name,
    startedAt: at.getTime(),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
  })
  await recordRun(home, {
    routine: r.name,
    at: at.getTime(),
    status: 'started',
    id,
    account: account.name,
    result,
    prompt: promptHash(r.prompt),
    ...(model ? { model } : {}),
  })
  return { status: 'started', id, account: account.name }
}
