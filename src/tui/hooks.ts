import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'

import { autopilot, AUTOPILOT_START, type AutopilotState } from '../autopilot.ts'
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
// after, so a change just made (a kept draft, a mark) never waits for the next poll.
export function useSnapshot(config: Config, load: Loader) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const snapRef = useRef<Snapshot | null>(null)
  const busy = useRef(false)
  const again = useRef(false)
  const polls = useRef(0)

  const refresh = useCallback(
    async (withAuth: boolean) => {
      if (busy.current) {
        again.current = true
        return
      }
      busy.current = true
      do {
        again.current = false
        try {
          const next = await load(config, snapRef.current, withAuth)
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

  return { snap, snapRef, error, refresh }
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
