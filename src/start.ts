import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { limitedNote, runModel, startBackground, unattendedPermissions } from './claude.ts'
import { chosen, defaultsFor, isLocal, type Account, type Config } from './config.ts'
import { recordConversation } from './conversations.ts'
import { deleteDraft, draftExists, type Draft } from './drafts.ts'
import { extraDirs, type Project } from './home.ts'
import { hopperPrompt, unattendedPrompt } from './prompts.ts'

// Where an unattended conversation reports: one file per draft, in the home folder.
export const resultsDir = (home: string) => join(home, 'results')
export const draftResultPath = (home: string, draftId: string) =>
  join(resultsDir(home), `${draftId}.md`)

// The guide Hopper writes for agents (guide.ts).
export const guidePath = (home: string) => join(home, 'CLAUDE.md')

// The drafts being started right now, by id. Starting takes a second or two, and the draft is
// only removed once its session is up, so without this a second start in that time (s pressed
// again, a double tap on the phone, the dispatcher reaching a queued one) starts it twice.
const starting = new Set<string>()
export const isStarting = (draftId: string) => starting.has(draftId)

export class AlreadyStartingError extends Error {
  constructor() {
    super('That draft is starting already')
  }
}

// Starts a draft as a Claude Code background session in the project's run folder, records what
// Claude Code won't report about it, and removes the draft. Unattended (the dispatcher starting
// queued work) it runs in auto permission mode, in a worktree whatever the draft says (runs
// started together would otherwise edit the same checkout), and writes a result file. Throws UntrustedError
// from startBackground for a folder Claude hasn't been told to trust.
export async function startDraft(opts: {
  config: Config
  project: Project
  account: Account
  draft: Draft
  unattended: boolean
  now?: number
}): Promise<{ id: string; name: string; result?: string }> {
  const { id } = opts.draft
  if (starting.has(id)) throw new AlreadyStartingError()
  starting.add(id)
  try {
    // Gone: started (or thrown away) since whoever is starting it last looked.
    if (!(await draftExists(opts.config.home, id)))
      throw new Error('That draft has started already')
    return await launch(opts)
  } finally {
    starting.delete(id)
  }
}

async function launch(opts: Parameters<typeof startDraft>[0]) {
  const { config, project, account, draft: d, unattended } = opts
  const home = config.home
  const text = d.text.trim()
  await mkdir(project.path, { recursive: true })
  const first = (text.split('\n')[0] ?? '').slice(0, 48)
  const name = `${project.key} · ${first}`
  const result = unattended ? draftResultPath(home, d.id) : undefined
  if (result) await mkdir(resultsDir(home), { recursive: true })
  const { model, effort, ...picked } = chosen(d, defaultsFor(config, project))
  const worktree = unattended || picked.worktree === 'yes'
  const perms = result ? unattendedPermissions(model, [resultsDir(home)], account) : undefined
  const systemPrompt = [
    hopperPrompt(project, { unattended, guide: guidePath(home) }),
    result
      ? unattendedPrompt({
          result,
          draft: d.id,
          done: d.done,
          depth: d.depth,
          chainDepth: config.overnight.chainDepth,
        })
      : '',
    perms?.allowedTools ? limitedNote([resultsDir(home)]) : '',
  ]
    .filter(Boolean)
    .join(' ')
  const id = await startBackground(account, {
    cwd: project.runIn,
    name,
    prompt: text,
    systemPrompt,
    model,
    effort,
    worktree,
    addDirs: [...(result ? [resultsDir(home)] : []), ...extraDirs(project)],
    ...perms,
  })
  await recordConversation(home, id, {
    project: project.key,
    startedAt: opts.now ?? Date.now(),
    draft: d.id,
    model: runModel(account, model),
    ...(isLocal(account) ? {} : { effort }),
    worktree,
    ...(result ? { unattended: true, result } : {}),
    ...(d.depth ? { depth: d.depth } : {}),
    ...(d.queue ? { queue: d.queue } : {}),
  })
  await deleteDraft(home, d.id)
  return { id, name, ...(result ? { result } : {}) }
}
