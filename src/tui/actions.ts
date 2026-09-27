import { realpathSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'

import { runInteractive, startBackground, UntrustedError } from '../claude.ts'
import {
  addAccount,
  ConfigError,
  parsePrefixList,
  relabel,
  removeAccount,
  setPrefixes,
  type Account,
  type Config,
} from '../config.ts'
import { recordConversation } from '../conversations.ts'
import { loadDone, saveDone } from '../done.ts'
import { deleteDraft, newDraftId, saveDraft, type Draft } from '../drafts.ts'
import { when } from '../format.ts'
import { draftSessionId, inScope, routineSessionId, type Item } from '../model.ts'
import { expandHome, isWithin, tildify } from '../paths.ts'
import { hopperPrompt } from '../prompts.ts'
import {
  deleteRoutine,
  listRoutines,
  nextRun,
  ROUTINE_NAME,
  runRoutine,
  saveRoutine,
  syncLaunchd,
  type Routine,
} from '../routines/index.ts'
import { pickAccount } from '../routing.ts'
import { copyToClipboard } from './clipboard.ts'
import type { AppCtx } from './context.ts'
import { EmbeddedSession } from './embed.ts'
import { MOUSE_OFF, MOUSE_ON } from './mouse.ts'
import {
  newEditing,
  now,
  toDraft,
  toRoutine,
  type Editing,
  type Focus,
  type Form,
  type Panel,
} from './state.ts'

// Keeps launchd in step with the routine files, pointing it at the hopper command running now.
export const defaultSync = (config: Config, routines: Routine[]) =>
  syncLaunchd(config, routines, { hopper: realpathSync(process.argv[1] ?? 'hopper') })

const whenNext = (schedule: string) => {
  const n = nextRun(schedule, new Date())
  return n ? `next ${when(n.getTime())}` : 'run-now only'
}

// Trusting Hopper's home once covers every meta/ project inside it.
const trustDir = (config: Config, dir: string) => (isWithin(dir, config.home) ? config.home : dir)

// Everything the app does in response to a key: starting conversations, opening them, saving
// drafts and routines, account edits. Built from the current context on every render.
export function makeActions(ctx: AppCtx) {
  const { config, snap, refresh, setMessage, setEditing, setForm, setSel } = ctx

  const go = (f: Focus) => {
    ctx.setFocus(f)
    setMessage(null)
  }

  const focusProject = (key: string) => {
    ctx.setScope(key)
    // Unfold the folders above it, so the tree shows where it is.
    ctx.setFolded((f) => new Set([...f].filter((k) => !inScope(key, k) || k === key)))
    setSel((s) => ({ ...s, work: 0, done: 0 }))
    go('work')
  }

  // Where a new conversation goes: the project under the cursor, else the scope, else the inbox.
  const newConversation = () => {
    const row = ctx.selectedRow
    const here =
      ctx.focus === 'projects' && row && ctx.projectKeys.includes(row.key) ? row.key : null
    const key = here ?? ctx.scopeProject ?? 'meta/inbox'
    const project = snap?.projects.find((p) => p.key === key)
    setEditing(
      newEditing({
        id: newDraftId(),
        project: key,
        text: '',
        created: now(),
        model: project?.model,
        effort: project?.effort,
      }),
    )
  }

  const reopenDraft = (d: Draft) =>
    setEditing(
      newEditing({
        id: d.id,
        project: d.project,
        text: d.text,
        created: d.created,
        model: d.model,
        effort: d.effort,
      }),
    )

  const keepDraft = async (e: Editing) => {
    setEditing(null)
    if (!e.text.trim()) return setMessage('Nothing written, so nothing kept.')
    setMessage('Kept as a draft. It waits in Needs you; ⏎ on it keeps writing.')
    await saveDraft(config.home, toDraft(e, now()))
    void refresh(false)
  }

  // Opens a conversation in the right-hand panel and gives it the keyboard. Attach runs in the
  // conversation's own folder: Claude's agents view opens wherever attach runs, and that folder
  // is one Claude already trusts.
  const openEmbedded = (account: Account, id: string, name: string, from: Panel, cwd: string) => {
    ctx.embed?.close()
    const { sessionCols, sessionRows } = ctx.layout
    const session = new EmbeddedSession(account, id, name, sessionCols, sessionRows, {
      onCopy: (text) => {
        copyToClipboard(text)
        setMessage(`Copied ${text.length} characters.`)
      },
      onLeave: () => {
        ctx.setEmbed((cur) => (cur === session ? null : cur))
        ctx.setFocus(from)
        setMessage(
          'Back in Hopper. The conversation carries on, and waits in Needs you when Claude does.',
        )
        void refresh(false)
      },
    })
    session.start(cwd)
    ctx.setEmbed(session)
    ctx.setEmbedShown(true)
    ctx.setReturnTo(from)
    ctx.setFocus('session')
  }

  // Starting hands the draft to Claude Code as a background session in the project's folder,
  // then opens it, so it's the normal Claude conversation from here on.
  const start = async (e: Editing) => {
    const text = e.text.trim()
    if (!text) return setMessage('Write something first.')
    const project = snap?.projects.find((p) => p.key === e.project)
    if (!project) return setMessage(`No project ${e.project}.`)
    const pick = pickAccount(config, project.key, snap?.accounts ?? [])
    if (!pick.account) return setMessage(`Can't start: ${pick.reason}.`)
    const account = pick.account
    await saveDraft(config.home, toDraft(e, now()))
    setEditing(null)
    setMessage(`Starting on ${account.name}${e.model ? ' with ' + e.model : ''}…`)
    try {
      await mkdir(project.path, { recursive: true })
      const name = `${project.key} · ${(text.split('\n')[0] ?? '').slice(0, 48)}`
      const id = await startBackground(account, {
        cwd: project.path,
        name,
        prompt: text,
        systemPrompt: hopperPrompt(project.key, project.openFile),
        model: e.model,
        effort: e.effort,
      })
      // Claude Code doesn't report the model per session, so Hopper keeps it.
      await recordConversation(config.home, id, {
        project: project.key,
        startedAt: now(),
        ...(e.model ? { model: e.model } : {}),
        ...(e.effort ? { effort: e.effort } : {}),
      })
      await deleteDraft(config.home, e.id)
      await refresh(false)
      openEmbedded(account, id, name, 'work', project.path)
    } catch (err) {
      if (err instanceof UntrustedError) {
        const dir = trustDir(config, err.dir)
        ctx.setUntrusted({ dir, draft: e })
        setMessage(
          `T opens Claude once in this folder so you can trust it; then it starts. ${tildify(dir)}`,
        )
      } else setMessage(`${(err as Error).message}. Your draft is kept.`)
      void refresh(false)
    }
  }

  // Opens Claude interactively in the folder so its trust prompt can be accepted, then starts.
  const trust = async () => {
    const u = ctx.untrusted
    if (!u) return
    const pick = pickAccount(config, u.draft.project, snap?.accounts ?? [])
    if (!pick.account) return setMessage(`Can't start: ${pick.reason}.`)
    const account = pick.account
    await ctx.suspendTerminal(async () => {
      process.stdout.write(MOUSE_OFF)
      process.stdout.write(
        `\nAccept Claude's trust prompt for ${tildify(u.dir)}, then type /exit to come back to Hopper.\n\n`,
      )
      await runInteractive(account, [], u.dir)
      process.stdout.write(MOUSE_ON)
    })
    ctx.setUntrusted(null)
    await start(u.draft)
  }

  const markDone = async (item: Item | undefined, done: boolean) => {
    if (!item) return
    const set = await loadDone(config.home)
    if (done) set.add(item.sessionId)
    else set.delete(item.sessionId)
    await saveDone(config.home, set)
    setMessage(done ? `Done: ${item.name}` : `Back in Needs you: ${item.name}`)
    await refresh(false)
  }

  const openRoutine = (item: Item) => {
    const r = snap?.routines.find((x) => routineSessionId(x.name) === item.sessionId)
    if (!r) return
    setEditing(
      newEditing({
        id: 'routine:' + r.name,
        project: r.project,
        text: r.prompt,
        created: now(),
        stage: 'act',
        model: r.model,
        effort: r.effort,
        routine: { name: r.name, schedule: r.schedule, enabled: r.enabled },
      }),
    )
  }

  // ⏎ on anything in the lists.
  const open = (item: Item | undefined) => {
    if (!item) return
    if (item.kind === 'routine') return openRoutine(item)
    if (item.kind === 'draft') {
      const d = snap?.drafts.find((x) => draftSessionId(x.id) === item.sessionId)
      return d ? reopenDraft(d) : undefined
    }
    const account = config.accounts.find((a) => a.name === item.account)
    if (!item.id || !account)
      return setMessage('That is an interactive terminal. Switch to it directly.')
    // Already open in the panel: just go back in.
    if (ctx.embed && ctx.embed.id === item.id) {
      ctx.setReturnTo(ctx.listFocus)
      ctx.setEmbedShown(true)
      return ctx.setFocus('session')
    }
    openEmbedded(account, item.id, item.name, ctx.listFocus, item.cwd)
  }

  // Routines: saved on esc, and launchd kept in step every time one changes.
  const saveAndSync = async (r: Routine) => {
    await saveRoutine(config.home, r)
    await ctx.syncSchedule(config, await listRoutines(config.home))
    void refresh(false)
  }

  const keepRoutine = async (e: Editing) => {
    const r = e.routine
    if (!r) return
    setEditing(null)
    try {
      await saveAndSync(toRoutine(e, r.name, r.schedule, r.enabled))
      setMessage(`Saved ${r.name} · ${r.enabled ? whenNext(r.schedule) : 'paused'}`)
    } catch (err) {
      setMessage((err as Error).message)
    }
  }

  // Run now: the testing loop. Saves the prompt, runs it, and opens the run.
  const runNow = async (e: Editing) => {
    if (!e.routine) return
    const r = toRoutine(e, e.routine.name, e.routine.schedule, e.routine.enabled)
    setEditing(null)
    try {
      await saveAndSync(r)
      const out = await runRoutine({
        config,
        routine: r,
        projects: snap?.projects ?? [],
        accounts: snap?.accounts ?? [],
        sessions: snap?.items ?? [],
        systemPrompt: (p) => hopperPrompt(p.key, p.openFile),
      })
      if (out.status === 'skipped') return setMessage(`Skipped ${r.name}: ${out.reason}.`)
      await refresh(false)
      const account = config.accounts.find((a) => a.name === out.account)
      const project = snap?.projects.find((p) => p.key === r.project)
      if (account && project) openEmbedded(account, out.id, `↻ ${r.name}`, 'work', project.path)
    } catch (err) {
      if (err instanceof UntrustedError) {
        setMessage(
          `Claude hasn't been told to trust ${tildify(trustDir(config, err.dir))}. Start any conversation there once (t) to trust it.`,
        )
      } else setMessage((err as Error).message)
    }
  }

  // Every account edit is saved at once; a bad one leaves the old config and says why.
  const commit = async (edit: (c: Config) => Config, done?: string) => {
    try {
      const next = edit(config)
      await ctx.save(next)
      ctx.setConfig(next)
      if (done) setMessage(done)
      return next
    } catch (e) {
      setMessage(e instanceof ConfigError ? e.message : `Could not save: ${(e as Error).message}`)
      return null
    }
  }

  const signIn = async (account: Account) => {
    await ctx.suspendTerminal(async () => {
      process.stdout.write(MOUSE_OFF)
      if (account.configDir) await mkdir(account.configDir, { recursive: true })
      process.stdout.write(
        `\nSigning in ${account.name} (${account.label}). Hopper comes back when this finishes.\n\n`,
      )
      await runInteractive(account, ['auth', 'login'])
      process.stdout.write(MOUSE_ON)
    })
    await refresh(true)
    // A new account starts labelled with its short name; take the org's name once we know it.
    const auth = ctx.snapRef.current?.accounts.find((s) => s.account.name === account.name)?.auth
    if (auth?.loggedIn && account.label === account.name && (auth.orgName || auth.email)) {
      await commit((c) => relabel(c, account.name, auth.orgName ?? auth.email ?? account.name))
    }
    setMessage(
      auth?.loggedIn ? `${account.name} is signed in` : `${account.name} is still signed out`,
    )
  }

  const submitRoutineForm = async (f: Form) => {
    if (f.kind === 'routine-name') {
      const name = f.value.trim()
      if (!ROUTINE_NAME.test(name)) return setMessage('Use lowercase letters, digits and hyphens.')
      if (snap?.routines.some((r) => r.name === name)) return setMessage(`"${name}" is taken.`)
      return setForm({ kind: 'routine-schedule', value: 'weekdays 9:00', editing: f.editing, name })
    }
    if (f.kind === 'routine-schedule') {
      const schedule = f.value.trim()
      const e = f.editing
      try {
        await saveRoutine(config.home, toRoutine(e, f.name, schedule, e.routine?.enabled ?? true))
      } catch (err) {
        return setMessage((err as Error).message)
      }
      setForm(null)
      setEditing(null)
      // A draft that became a routine is no longer a draft.
      if (!e.routine) await deleteDraft(config.home, e.id)
      await ctx.syncSchedule(config, await listRoutines(config.home))
      setMessage(
        `${f.name} · ${schedule || 'no schedule'} · ${whenNext(schedule)}. ⏎ on it edits; s runs it now.`,
      )
      return void refresh(false)
    }
    if (f.kind === 'routine-remove') {
      setForm(null)
      await deleteRoutine(config.home, f.name)
      await ctx.syncSchedule(config, await listRoutines(config.home))
      setMessage(`Removed the routine ${f.name}. Its past runs stay in Done.`)
      return void refresh(false)
    }
  }

  const submitAccountForm = async (f: Form) => {
    if (f.kind === 'add-name') {
      const name = f.value.trim()
      if (!name) return setForm(null)
      if (config.accounts.some((a) => a.name === name)) return setMessage(`"${name}" is taken.`)
      const hasDefault = config.accounts.some((a) => a.configDir === null)
      return setForm({ kind: 'add-dir', name, value: hasDefault ? `~/.claude-${name}` : 'default' })
    }
    setForm(null)
    if (f.kind === 'add-dir') {
      const dir = f.value.trim()
      const account: Account = {
        name: f.name,
        label: f.name,
        configDir: dir === '' || dir === 'default' ? null : expandHome(dir),
      }
      const next = await commit((c) => addAccount(c, account), `added ${f.name}`)
      if (next) {
        setSel((s) => ({ ...s, accounts: next.accounts.length - 1 }))
        await signIn(account)
      }
    } else if (f.kind === 'prefixes') {
      await commit(
        (c) => setPrefixes(c, f.name, parsePrefixList(f.value)),
        `${f.name} routes saved`,
      )
    } else if (f.kind === 'label') {
      await commit((c) => relabel(c, f.name, f.value), `renamed ${f.name}`)
    } else if (f.kind === 'remove') {
      await commit(
        (c) => removeAccount(c, f.name),
        `removed ${f.name} from Hopper; its login is untouched`,
      )
      setSel((s) => ({ ...s, accounts: Math.max(0, s.accounts - 1) }))
    }
  }

  const submitForm = (f: Form) =>
    f.kind.startsWith('routine-') ? submitRoutineForm(f) : submitAccountForm(f)

  return {
    go,
    focusProject,
    newConversation,
    keepDraft,
    start,
    trust,
    markDone,
    open,
    keepRoutine,
    runNow,
    commit,
    signIn,
    submitForm,
  }
}

export type Actions = ReturnType<typeof makeActions>
