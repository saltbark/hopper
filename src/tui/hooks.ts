import { useCallback, useEffect, useRef, useState } from 'react'

import { refreshUsage, usageLines } from '../claude.ts'
import type { Account, Config } from '../config.ts'
import { saveDraft } from '../drafts.ts'
import { readItems, type OpenItem } from '../items.ts'
import type { gather, Snapshot } from '../model.ts'
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
