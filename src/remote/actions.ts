import { basename } from 'node:path'

import { UntrustedError } from '../claude.ts'
import { dispatchOnce } from '../commands.ts'
import { chosen, defaultsFor, type Config } from '../config.ts'
import { EFFORTS, MODELS, WORKTREE_CHOICES } from '../conversations.ts'
import { setDone } from '../done.ts'
import { deleteDraft, newDraftId, saveDraft, type Draft } from '../drafts.ts'
import { readIfThere } from '../fsutil.ts'
import { setHeld } from '../held.ts'
import { readItems } from '../items.ts'
import { routineSessionId, type Snapshot } from '../model.ts'
import { tildify } from '../paths.ts'
import { hopperPrompt } from '../prompts.ts'
import { runRoutine, saveRoutine } from '../routines/index.ts'
import { pickAccount } from '../routing.ts'
import { markRead } from '../seen.ts'
import { startDraft } from '../start.ts'
import { groupOf } from '../tui/state.ts'

// What the phone can do besides look and type: start or queue a conversation, hold or archive
// one, resume, pause or run a routine. Each goes through the same code as the key on the Mac
// (actions.ts in the app), so the two can't disagree; this only reads the message and says how it
// went. Every action carries a `ref` the answer echoes, so the phone can show the right toast.
//
//   new      {project}                                   → newinfo: open items, defaults, route
//   start    {project, text, model?, effort?, worktree?, account?, queue?: 'now' | 'night', draft?, id?}
//            draft: true saves it as a draft and starts nothing; id: an existing draft (its
//            item id, draft:<id>) that this replaces
//   discard  {id}   throws a draft away
//   hold     {id}   toggles a waiting conversation on and off hold
//   done     {id, undo?}   archives it, or brings it back from Archived
//   routine  {id, do: 'resume' | 'pause' | 'run'}
//   routineinfo {id}           → its prompt, schedule, model and reports (newest first)
//   report   {id, file}        → that report's markdown; it counts as read, as on the Mac

export type ActDeps = {
  config: Config
  snap: Snapshot | null
  // Loads a fresh snapshot, which the bridge then sends.
  refresh: () => Promise<void>
  // Swappable for tests.
  start?: typeof startDraft
  dispatch?: (config: Config) => Promise<unknown>
  run?: typeof runRoutine
}

export type Answer = Record<string, unknown> & { t: string }

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export const ACTIONS = new Set([
  'new',
  'start',
  'discard',
  'hold',
  'done',
  'routine',
  'routineinfo',
  'report',
])

// A draft's id from what the phone sends: its item id (draft:<id>) or the bare id.
const draftId = (v: unknown) => str(v)?.replace(/^draft:/, '')

// How many of a routine's reports the phone is told about.
export const REPORTS_SENT = 30

// The longest prompt taken from the phone, and the most of a report sent to it: both well under
// what the relay carries in one message (MAX_FRAME in link.ts).
export const PROMPT_MAX = 100_000
export const REPORT_MAX = 200_000

// A choice from the phone, checked against the ones the Mac offers: undefined when it sent none,
// null when it sent one Hopper doesn't have. Nothing the phone sends reaches claude's arguments
// unchecked.
function choice(v: unknown, allowed: readonly (string | undefined)[]): string | undefined | null {
  const s = str(v)
  if (s === undefined) return undefined
  return allowed.includes(s) ? s : null
}

export async function act(m: Record<string, unknown>, deps: ActDeps): Promise<Answer> {
  const ref = m['ref'] ?? null
  const ok = (text: string, extra: Record<string, unknown> = {}) => ({
    t: 'result',
    ref,
    ok: true,
    text,
    ...extra,
  })
  const no = (text: string) => ({ t: 'result', ref, ok: false, text })
  const { config, snap } = deps
  if (!snap) return no('Hopper is still loading.')
  try {
    switch (m['t']) {
      case 'new': {
        const project = snap.projects.find((p) => p.key === m['project'])
        if (!project) return no(`No project ${String(m['project'])}.`)
        const defaults = defaultsFor(config, project)
        const pick = pickAccount(config, project.key, snap.accounts, defaults.model)
        const items = (await readItems(project)) ?? []
        return {
          t: 'newinfo',
          ref,
          project: project.key,
          runIn: tildify(project.runIn),
          items: items.map((i) => i.title).slice(0, 40),
          defaults,
          route: pick.account?.name ?? null,
          routeWhy: pick.account ? null : pick.reason,
          models: MODELS.filter((x): x is Exclude<typeof x, undefined> => !!x),
          efforts: EFFORTS.filter((x): x is Exclude<typeof x, undefined> => !!x),
          accounts: config.accounts.map((a) => ({ name: a.name, label: a.label })),
        }
      }

      case 'start': {
        const text = str(m['text'])?.trim()
        if (!text) return no('Nothing to start: the prompt is empty.')
        if (text.length > PROMPT_MAX) return no('That prompt is too long to send from the phone.')
        const project = snap.projects.find((p) => p.key === m['project'])
        if (!project) return no(`No project ${String(m['project'])}.`)
        const picked = {
          model: choice(m['model'], MODELS),
          effort: choice(m['effort'], EFFORTS),
          worktree: choice(m['worktree'], WORKTREE_CHOICES),
          account: choice(
            m['account'],
            config.accounts.map((a) => a.name),
          ),
        }
        for (const [what, v] of Object.entries(picked))
          if (v === null) return no(`Hopper has no ${what} "${String(m[what])}".`)
        const now = Date.now()
        const queue = m['queue'] === 'now' || m['queue'] === 'night' ? m['queue'] : undefined
        // Editing one that's there keeps what the phone doesn't show (after, done, depth) and
        // when it was made; what the phone does show is replaced.
        const id = draftId(m['id'])
        const was = id ? snap.drafts.find((d) => d.id === id) : undefined
        if (id && !was) return no('That draft is gone: started or thrown away on the Mac.')
        const draft: Draft = {
          id: was?.id ?? newDraftId(now),
          project: project.key,
          text,
          created: was?.created ?? now,
          updated: now,
          ...(was?.after ? { after: was.after } : {}),
          ...(was?.done ? { done: was.done } : {}),
          ...(was?.depth ? { depth: was.depth } : {}),
          // Proposed by an agent until it's queued, as on the Mac.
          ...(was?.proposed && !queue ? { proposed: was.proposed } : {}),
          ...(picked.model ? { model: picked.model } : {}),
          ...(picked.effort ? { effort: picked.effort } : {}),
          ...(picked.worktree ? { worktree: picked.worktree } : {}),
          ...(picked.account ? { account: picked.account } : {}),
          ...(queue ? { queue } : {}),
        }
        // Kept as a draft, to start later from either side: what Hopper's editor saves on esc.
        if (m['draft'] === true) {
          await saveDraft(config.home, draft)
          await deps.refresh()
          return ok(was ? 'Saved.' : 'Saved as a draft.')
        }
        if (queue) {
          await saveDraft(config.home, draft)
          if (queue === 'now') await (deps.dispatch ?? dispatchOnce)(config)
          await deps.refresh()
          return ok(
            queue === 'now'
              ? 'Queued: starts when an account has room.'
              : `Queued for tonight (${config.overnight.window}).`,
          )
        }
        const { model } = chosen(draft, defaultsFor(config, project))
        const pick = pickAccount(config, project.key, snap.accounts, model, draft.account)
        if (!pick.account) return no(`Can't start: ${pick.reason}.`)
        await saveDraft(config.home, draft)
        try {
          const { name } = await (deps.start ?? startDraft)({
            config,
            project,
            account: pick.account,
            draft,
            unattended: false,
          })
          await deps.refresh()
          return ok(`Started on ${pick.account.name}: ${name}`)
        } catch (e) {
          await deps.refresh()
          if (e instanceof UntrustedError)
            return no(
              `Claude doesn't trust ${tildify(e.dir)} yet. Start one there on the Mac once (T); the draft is kept.`,
            )
          return no(`${(e as Error).message}. The draft is kept.`)
        }
      }

      case 'discard': {
        const id = draftId(m['id'])
        const d = id ? snap.drafts.find((x) => x.id === id) : undefined
        if (!d) return no('That draft is gone already.')
        await deleteDraft(config.home, d.id)
        await deps.refresh()
        return ok('Thrown away.')
      }

      case 'hold': {
        const item = snap.items.find((i) => i.sessionId === m['id'])
        if (!item) return no('That conversation is gone.')
        const g = groupOf(item)
        if (g !== 'waiting' && g !== 'held')
          return no('Only a conversation waiting on you goes on hold.')
        await setHeld(config.home, item.sessionId, g === 'waiting')
        await deps.refresh()
        return ok(
          g === 'waiting' ? `On hold: ${item.name}` : `Back in waiting on you: ${item.name}`,
        )
      }

      case 'done': {
        const item = snap.items.find((i) => i.sessionId === m['id'])
        if (!item) return no('That conversation is gone.')
        const undo = m['undo'] === true
        await setDone(config.home, item.sessionId, !undo)
        await deps.refresh()
        return ok(undo ? `Back in conversations: ${item.name}` : `Archived: ${item.name}`)
      }

      case 'routine': {
        const r = snap.routines.find(
          (x) => routineSessionId(x.name) === m['id'] || x.name === m['id'],
        )
        if (!r) return no('No such routine.')
        const what = m['do']
        if (what === 'resume' || what === 'pause') {
          await saveRoutine(config.home, { ...r, enabled: what === 'resume' })
          await deps.refresh()
          return ok(what === 'resume' ? `Resumed ${r.name}.` : `Paused ${r.name}.`)
        }
        if (what === 'run') {
          const out = await (deps.run ?? runRoutine)({
            config,
            routine: r,
            projects: snap.projects,
            accounts: snap.accounts,
            sessions: snap.items,
            systemPrompt: hopperPrompt,
          })
          await deps.refresh()
          if (out.status === 'skipped') return no(`Skipped ${r.name}: ${out.reason}.`)
          if (out.status === 'passed') return ok(`${r.name}: the check passed, so nothing to run.`)
          return ok(`Running ${r.name} on ${out.account}.`)
        }
        return no('Resume, pause or run.')
      }

      case 'routineinfo': {
        const r = snap.routines.find(
          (x) => routineSessionId(x.name) === m['id'] || x.name === m['id'],
        )
        if (!r) return no('No such routine.')
        const item = snap.items.find((i) => i.sessionId === routineSessionId(r.name))
        const defaults = defaultsFor(
          config,
          snap.projects.find((p) => p.key === r.project),
        )
        return {
          t: 'routineinfo',
          ref,
          name: r.name,
          project: r.project,
          schedule: r.schedule,
          enabled: r.enabled,
          prompt: r.prompt,
          model: r.model ?? `${defaults.model} (default)`,
          effort: r.effort ?? `${defaults.effort} (default)`,
          check: r.check ?? null,
          nextAt: item?.nextAt ?? null,
          reports: (snap.reports[r.name] ?? []).slice(0, REPORTS_SENT).map((rep) => ({
            file: basename(rep.path),
            at: rep.at,
            summary: rep.summary.slice(0, 200),
            unread: !!rep.unread,
            account: rep.account ?? null,
          })),
        }
      }

      case 'report': {
        const r = snap.routines.find(
          (x) => routineSessionId(x.name) === m['id'] || x.name === m['id'],
        )
        const reports = r ? (snap.reports[r.name] ?? []) : []
        // Only a report Hopper lists for this routine: the phone names it, never a path.
        const rep = reports.find((x) => basename(x.path) === m['file'])
        if (!r || !rep) return no('That report is gone.')
        const whole = (await readIfThere(rep.path)) ?? ''
        const markdown =
          whole.length > REPORT_MAX
            ? `${whole.slice(0, REPORT_MAX)}\n\n*Cut here: the whole report is on the Mac.*`
            : whole
        if (rep.unread) {
          await markRead(config.home, r.name, [rep.path], reports)
          await deps.refresh()
        }
        return { t: 'report', ref, routine: r.name, at: rep.at, markdown }
      }
    }
  } catch (e) {
    return no((e as Error).message)
  }
  return no(`Hopper doesn't know "${String(m['t'])}".`)
}
