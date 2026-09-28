import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { DEFAULT_SOUND, newlyWaiting, type Chime } from '../chime.ts'
import { refreshUsage, usageLines } from '../claude.ts'
import type { Account, Config } from '../config.ts'
import { saveDraft } from '../drafts.ts'
import { readItems, type OpenItem } from '../items.ts'
import type { gather, Item, Snapshot } from '../model.ts'
import { expandHome } from '../paths.ts'
import { parseProjectsDoc, type ProjectsDoc } from '../settings.ts'
import { now, toDraft, type Editing } from './state.ts'

export type Loader = typeof gather

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
      try {
        do {
          again.current = false
          const next = await load(config, snapRef.current, withAuth)
          snapRef.current = next
          setSnap(next)
          setError(null)
        } while (again.current)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        busy.current = false
      }
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
        if (st.auth?.loggedIn && (old || !usageText[st.account.name])) void askUsage(st.account)
      }
    }
    const first = setTimeout(check, 1500)
    const t = setInterval(check, 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [askUsage, usageText, snapRef])

  return { usageText, askUsage }
}

// A draft saves itself a moment after you stop typing, so nothing written is lost. Routines
// save when you step out (esc) instead.
// A meta repo's registry runs to dozens of projects, so the top folder each one lands in starts
// collapsed. Once per folder: after that, folding is the person's.
export function useFoldImported(
  snap: Snapshot | null,
  setFolded: Dispatch<SetStateAction<Set<string>>>,
) {
  const seen = useRef(new Set<string>())
  useEffect(() => {
    const tops = (snap?.projects ?? []).filter((p) => p.meta).map((p) => p.key.split('/')[0] ?? '')
    const fresh = [...new Set(tops)].filter((t) => t && !seen.current.has(t))
    if (!fresh.length) return
    for (const t of fresh) seen.current.add(t)
    setFolded((f) => new Set([...f, ...fresh]))
  }, [snap, setFolded])
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

export function useDraftAutosave(editing: Editing | null, home: string) {
  useEffect(() => {
    if (!editing || editing.routine || !editing.text.trim()) return
    const d = toDraft(editing, now())
    const t = setTimeout(() => void saveDraft(home, d), 400)
    return () => clearTimeout(t)
  }, [editing, home])
}

// The open items of one project, read when it changes and on every refresh.
export function useProjectItems(snap: Snapshot | null, key: string | null) {
  const [items, setItems] = useState<{ key: string; items: OpenItem[] | null } | null>(null)
  useEffect(() => {
    const project = snap?.projects.find((p) => p.key === key)
    if (!project) return
    let live = true
    void readItems(project).then((its) => live && setItems({ key: project.key, items: its }))
    return () => {
      live = false
    }
  }, [key, snap])
  return items && items.key === key ? items.items : undefined
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
