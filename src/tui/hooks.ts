import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'

import { autopilot, AUTOPILOT_START, type AutopilotState } from '../autopilot.ts'
import { loadAwake, saveAwake, type KeepAwake } from '../awake.ts'
import { DEFAULT_SOUND, newlyWaiting, type Chime } from '../chime.ts'
import { refreshUsage, usageLines } from '../claude.ts'
import { dispatchOnce } from '../commands.ts'
import type { Account, Config } from '../config.ts'
import { saveDraft } from '../drafts.ts'
import { readItems, type OpenItem } from '../items.ts'
import { waitsOnMe, type gather, type Item, type Snapshot } from '../model.ts'
import { expandHome } from '../paths.ts'
import { hopperPrompt } from '../prompts.ts'
import { runRoutine } from '../routines/index.ts'
import { parseProjectsDoc, type ProjectsDoc } from '../settings.ts'
import type { Update, Updater } from '../update.ts'
import type { EmbeddedSession } from './embed.ts'
import { now, toDraft, type Editing } from './state.ts'
import { titleText } from './title.ts'

export type Loader = typeof gather

// The conversations open in Hopper, the one last gone into first. The ref is the same list as
// of the latest change, for callbacks that outlive a render (an attach ending, a start that
// awaited). All of them close when Hopper does; their conversations keep running.
export function useOpenConversations() {
  const [list, setList] = useState<EmbeddedSession[]>([])
  const embedsRef = useRef(list)
  const setEmbeds = useCallback((next: SetStateAction<EmbeddedSession[]>) => {
    embedsRef.current = typeof next === 'function' ? next(embedsRef.current) : next
    setList(embedsRef.current)
  }, [])
  useEffect(() => () => embedsRef.current.forEach((e) => e.close()), [])
  return { embeds: list, setEmbeds, embedsRef }
}

const SESSION_POLL_MS = 5_000
const AUTH_EVERY = 12 // polls, so about a minute
const USAGE_MAX_AGE_MS = 5 * 60_000

// What Hopper sees, polled. One refresh runs at a time; one asked for meanwhile runs straight
// after, so a change just made (a kept draft, a mark) never waits for the next poll. patch shows
// a change before any load does; a load that started before it is thrown away, not shown, so the
// change never flickers back.
export function useSnapshot(config: Config, load: Loader) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const snapRef = useRef<Snapshot | null>(null)
  const busy = useRef(false)
  const again = useRef(false)
  const polls = useRef(0)
  const patches = useRef(0)

  const refresh = useCallback(
    async (withAuth: boolean) => {
      if (busy.current) {
        again.current = true
        return
      }
      busy.current = true
      do {
        again.current = false
        const before = patches.current
        try {
          const next = await load(config, snapRef.current, withAuth)
          if (patches.current !== before) {
            again.current = true
            continue
          }
          snapRef.current = next
          setSnap(next)
          setError(null)
        } catch (e) {
          setError((e as Error).message)
        }
      } while (again.current)
      busy.current = false
    },
    [config, load],
  )

  useEffect(() => {
    void refresh(true)
    const t = setInterval(() => {
      polls.current++
      void refresh(polls.current % AUTH_EVERY === 0)
    }, SESSION_POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const patch = useCallback((change: (s: Snapshot) => Snapshot) => {
    if (!snapRef.current) return
    patches.current++
    snapRef.current = change(snapRef.current)
    setSnap(snapRef.current)
  }, [])

  return { snap, snapRef, error, refresh, patch }
}

// Usage is Claude Code's cache. Keep it fresh by asking /usage (free, answered locally) for any
// signed-in account whose numbers are more than five minutes old, checked once a minute. Keeps
// what /usage said, which names limits the cache doesn't label.
export function useUsage(
  home: string,
  snapRef: { current: Snapshot | null },
  refresh: (withAuth: boolean) => Promise<void>,
) {
  const [usageText, setUsageText] = useState<Record<string, string[]>>({})
  const asking = useRef(new Set<string>())
  // Read by the minute's check, which shouldn't start over each time an answer comes in.
  const answered = useRef(usageText)
  useEffect(() => {
    answered.current = usageText
  }, [usageText])

  const askUsage = useCallback(
    async (account: Account) => {
      if (asking.current.has(account.name)) return
      asking.current.add(account.name)
      try {
        const text = await refreshUsage(account, home)
        setUsageText((u) => ({ ...u, [account.name]: usageLines(text) }))
        await refresh(false)
      } catch {
        // Leave the old numbers; the panel says how old they are.
      } finally {
        asking.current.delete(account.name)
      }
    },
    [home, refresh],
  )

  useEffect(() => {
    const check = () => {
      for (const st of snapRef.current?.accounts ?? []) {
        const old = !st.usage || now() - st.usage.fetchedAt > USAGE_MAX_AGE_MS
        if (st.auth?.loggedIn && (old || !answered.current[st.account.name]))
          void askUsage(st.account)
      }
    }
    const first = setTimeout(check, 1500)
    const t = setInterval(check, 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [askUsage, snapRef])

  return { usageText, askUsage }
}

type SettingsDoc = { doc: ProjectsDoc | null; missing: string[]; error: string | null }

async function loadSettingsDoc(home: string): Promise<SettingsDoc> {
  try {
    const doc = parseProjectsDoc(await readFile(join(home, 'projects.toml'), 'utf8'))
    const missing: string[] = []
    for (const s of doc.source) {
      const repo = typeof s['repo'] === 'string' ? s['repo'] : ''
      if (!(await stat(expandHome(repo)).catch(() => null))) missing.push(String(s['prefix']))
    }
    return { doc, missing, error: null }
  } catch (e) {
    return { doc: null, missing: [], error: `projects.toml: ${(e as Error).message}` }
  }
}

// projects.toml as the settings screen shows it, read when the screen opens and after each
// change; and which sources' repos aren't on this machine.
export function useSettingsDoc(open: boolean, home: string) {
  const [state, setState] = useState<SettingsDoc>({ doc: null, missing: [], error: null })
  useEffect(() => {
    if (!open) return
    let live = true
    void loadSettingsDoc(home).then((r) => live && setState(r))
    return () => {
      live = false
    }
  }, [open, home])
  const reload = useCallback(async () => setState(await loadSettingsDoc(home)), [home])
  return { ...state, reload }
}

// A draft saves itself a moment after you stop typing, so nothing written is lost. Routines
// save when you step out (esc) instead.
export function useDraftAutosave(editing: Editing | null, home: string) {
  useEffect(() => {
    if (!editing || editing.routine || !editing.text.trim()) return
    const d = toDraft(editing, now())
    const t = setTimeout(() => void saveDraft(home, d), 400)
    return () => clearTimeout(t)
  }, [editing, home])
}

// The open items of one project, read when it changes and on every refresh. What each project's
// file said last is kept, so coming back to one shows it at once, and a read that finds nothing
// new doesn't draw the screen again.
export function useProjectItems(snap: Snapshot | null, key: string | null) {
  const [read, setRead] = useState<ReadonlyMap<string, OpenItem[] | null>>(() => new Map())
  useEffect(() => {
    const project = snap?.projects.find((p) => p.key === key)
    if (!project) return
    let live = true
    void readItems(project).then((its) => {
      if (!live) return
      setRead((m) => {
        const had = m.get(project.key)
        if (had !== undefined && JSON.stringify(had) === JSON.stringify(its)) return m
        return new Map(m).set(project.key, its)
      })
    })
    return () => {
      live = false
    }
  }, [key, snap])
  return key === null ? undefined : read.get(key)
}

// One sound for each look that finds a conversation, running last time, now waiting on me. Not
// for the one on screen: I'm already looking at it. Only a new look rings, so `onScreen` is read
// as it was then rather than watched.
export function useChime(
  snap: Snapshot | null,
  sound: string | undefined,
  onScreen: string | null,
  chime: Chime,
) {
  const prev = useRef<Item[] | null>(null)
  const latest = useRef({ sound, onScreen, chime })
  // Declared first, so it has run by the time the effect below reads it.
  useEffect(() => {
    latest.current = { sound, onScreen, chime }
  })
  useEffect(() => {
    if (!snap) return
    const now = latest.current
    const fresh = newlyWaiting(prev.current, snap.items, now.onScreen)
    prev.current = snap.items
    if (fresh.length) now.chime(now.sound ?? DEFAULT_SOUND)
  }, [snap])
}

// Keeps the tab titled "Hopper (n)", n being what needs you, and puts it back after anything
// that hands the terminal over (Claude sets its own title while it has it). Returns
// suspendTerminal wrapped to do that.
export function useTabTitle(
  snap: Snapshot | null,
  setTitle: (text: string) => void,
  suspendTerminal: (fn: () => Promise<void>) => Promise<void>,
) {
  const text = titleText(snap?.items.filter(waitsOnMe).length ?? 0)
  const last = useRef(text)
  useEffect(() => {
    last.current = text
    setTitle(text)
  }, [text, setTitle])
  return useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await suspendTerminal(fn)
      } finally {
        setTitle(last.current)
      }
    },
    [suspendTerminal, setTitle],
  )
}

// Runs routines when they're due and starts queued drafts as they become ready, while Hopper is
// open (autopilot.ts). Each snapshot is a chance; one pass at a time. Says what it started.
export function useAutopilot(
  config: Config,
  snap: Snapshot | null,
  refresh: (withAuth: boolean) => Promise<void>,
  say: (text: string) => void,
  on: boolean,
) {
  const state = useRef<AutopilotState>(AUTOPILOT_START)
  const busy = useRef(false)
  useEffect(() => {
    if (!on || !snap || busy.current) return
    busy.current = true
    void (async () => {
      try {
        const out = await autopilot({
          config,
          snap,
          now: new Date(),
          state: state.current,
          deps: {
            run: (routine) =>
              runRoutine({
                config,
                routine,
                projects: snap.projects,
                accounts: snap.accounts,
                sessions: snap.items,
                systemPrompt: hopperPrompt,
              }),
            dispatch: () => dispatchOnce(config, snap),
          },
        })
        state.current = out.state
        const said = [
          ...out.ran.map(({ routine, outcome: o }) =>
            o.status === 'started'
              ? `ran ${routine}`
              : o.status === 'passed'
                ? `${routine}: check passed`
                : `${routine} skipped: ${o.reason}`,
          ),
          ...(out.report?.started ?? []).map((x) => `started ${x.name}`),
        ]
        if (said.length) {
          say(`On its own: ${said.join(' · ')}`)
          void refresh(false)
        }
      } catch (e) {
        say(`Autopilot: ${(e as Error).message}`)
      } finally {
        busy.current = false
      }
    })()
  }, [config, snap, refresh, say, on])
}

// Holds the Mac awake while z has it on (awake.ts), from the last time Hopper was open. Without a
// way to (keepAwake null, off macOS) it is never on. A z before the saved state has loaded wins.
export function useAwake(home: string, keepAwake: KeepAwake | null) {
  const [on, setOn] = useState(false)
  const touched = useRef(false)
  useEffect(() => {
    if (!keepAwake) return
    void loadAwake(home).then((saved) => {
      if (!touched.current) setOn(saved)
    })
  }, [home, keepAwake])
  useEffect(() => (on && keepAwake ? keepAwake() : undefined), [on, keepAwake])
  const toggle = useCallback(() => {
    touched.current = true
    setOn(!on)
    void saveAwake(home, !on).catch(() => {})
  }, [home, on])
  return { awake: on && !!keepAwake, toggleAwake: keepAwake ? toggle : null }
}

// A newer Hopper (update.ts), for the bottom right and V: asked when the app opens and every hour
// after, though the site itself only every few hours. Without an updater (a copy built from git,
// or check_updates off) there is never one. A check landing mid-install doesn't undo the install.
const UPDATE_POLL_MS = 60 * 60_000

export function useUpdate(home: string, updater: Updater | null, say: (text: string) => void) {
  const [update, setUpdate] = useState<Update | null>(null)
  const installing = useRef(false)
  const found = useCallback((u: Update | null) => {
    if (!installing.current) setUpdate(u)
  }, [])
  useEffect(() => {
    if (!updater) return
    let live = true
    const ask = () =>
      void updater
        .check(home)
        .then((u) => live && found(u))
        .catch(() => {})
    ask()
    const timer = setInterval(ask, UPDATE_POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [home, updater, found])
  const checkNow = useCallback(async () => {
    const u = await updater!.check(home, true).catch(() => null)
    found(u)
    return u
  }, [home, updater, found])
  const install = useCallback(
    async (u: Update) => {
      if (!updater || installing.current) return
      installing.current = true
      setUpdate({ ...u, stage: 'installing' })
      say(`Installing Hopper ${u.version}…`)
      try {
        await updater.install(u.version)
        setUpdate({ ...u, stage: 'installed' })
        say(installedText(u.version))
      } catch (e) {
        setUpdate({ ...u, stage: 'available' })
        say(`Hopper ${u.version} didn't install: ${(e as Error).message}`)
      } finally {
        installing.current = false
      }
    },
    [updater, say],
  )
  return {
    update: updater ? update : null,
    checkUpdate: updater ? checkNow : null,
    installUpdate: install,
  }
}

export const installedText = (v: string) =>
  `Hopper ${v} is installed: quit (x x) and open it again to use it. Conversations keep running.`
