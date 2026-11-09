import { UntrustedError } from '../claude.ts'
import { dispatchOnce } from '../commands.ts'
import { chosen, defaultsFor, type Config } from '../config.ts'
import { EFFORTS, MODELS } from '../conversations.ts'
import { setDone } from '../done.ts'
import { newDraftId, saveDraft, type Draft } from '../drafts.ts'
import { setHeld } from '../held.ts'
import { readItems } from '../items.ts'
import { routineSessionId, type Snapshot } from '../model.ts'
import { tildify } from '../paths.ts'
import { hopperPrompt } from '../prompts.ts'
import { runRoutine, saveRoutine } from '../routines/index.ts'
import { pickAccount } from '../routing.ts'
import { startDraft } from '../start.ts'
import { groupOf } from '../tui/state.ts'

// What the phone can do besides look and type: start or queue a conversation, hold or archive
// one, resume, pause or run a routine. Each goes through the same code as the key on the Mac
// (actions.ts in the app), so the two can't disagree; this only reads the message and says how it
// went. Every action carries a `ref` the answer echoes, so the phone can show the right toast.
//
//   new      {project}                                   → newinfo: open items, defaults, route
//   start    {project, text, model?, effort?, worktree?, account?, queue?: 'now' | 'night'}
//   hold     {id}   toggles a waiting conversation on and off hold
//   done     {id, undo?}   archives it, or brings it back from Archived
//   routine  {id, do: 'resume' | 'pause' | 'run'}

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

export const ACTIONS = new Set(['new', 'start', 'hold', 'done', 'routine'])

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
        const project = snap.projects.find((p) => p.key === m['project'])
        if (!project) return no(`No project ${String(m['project'])}.`)
        const now = Date.now()
        const queue = m['queue'] === 'now' || m['queue'] === 'night' ? m['queue'] : undefined
        const draft: Draft = {
          id: newDraftId(now),
          project: project.key,
          text,
          created: now,
          updated: now,
          ...(str(m['model']) ? { model: str(m['model']) } : {}),
          ...(str(m['effort']) ? { effort: str(m['effort']) } : {}),
          ...(str(m['worktree']) ? { worktree: str(m['worktree']) } : {}),
          ...(str(m['account']) ? { account: str(m['account']) } : {}),
          ...(queue ? { queue } : {}),
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
    }
  } catch (e) {
    return no((e as Error).message)
  }
  return no(`Hopper doesn't know "${String(m['t'])}".`)
}
