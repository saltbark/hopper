import { isLocal } from '../config.ts'
import type { Item, Snapshot } from '../model.ts'
import { groupOf, groupRank } from '../tui/state.ts'

// What the phone is told: the snapshot cut down to what it shows, already grouped and sorted the
// way the Mac's list is, so the phone draws it and decides nothing. The app reads the same shape
// (ios/Hopper/Remote/Snapshot.swift); a field added here gets a line there.

export type PhoneItem = {
  id: string
  kind: Item['kind']
  title: string
  project: string
  account: string
  // The Mac's list group, or 'archived' for one marked done.
  group: ReturnType<typeof groupOf> | 'archived'
  state: string
  activeAt: number
  model?: string
  effort?: string
  nextAt?: number
  unread?: number
  waiting?: string
  queue?: string
  // A background conversation the phone can open (attach takes its id).
  attach?: boolean
  // A draft's own: its whole text, worktree, and whether its account was picked by hand, so the
  // phone opens it to edit with nothing to wait for.
  text?: string
  worktree?: string
  picked?: boolean
}

export type PhoneAccount = {
  name: string
  label: string
  color: string
  email?: string
  plan?: string
  local: boolean
  signedIn: boolean
  session?: { pct: number; resetsAt: string | null }
  week?: { pct: number; resetsAt: string | null }
  usageAt?: number
  running: number
  waiting: number
}

export type PhoneProject = { key: string; open: number | null; running: number; waiting: number }

export type PhoneView = {
  t: 'snapshot'
  at: number
  mac: string
  items: PhoneItem[]
  // Marked done (Archived on the Mac), newest first, the latest ARCHIVED_SENT of them.
  archived: PhoneItem[]
  accounts: PhoneAccount[]
  projects: PhoneProject[]
}

export const ARCHIVED_SENT = 60

const LISTED = new Set<Item['where']>(['queue', 'needs', 'routine'])

// The same order as the Mac's list (byGroup in App.tsx).
const order = (a: Item, b: Item) =>
  groupRank(groupOf(a)) - groupRank(groupOf(b)) ||
  (a.kind === 'routine' && b.kind === 'routine'
    ? (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) || a.name.localeCompare(b.name)
    : b.activeAt - a.activeAt)

const pick = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T

export function phoneView(
  snap: Snapshot,
  mac: string,
  color: (account: string) => string,
): PhoneView {
  const listed = snap.items.filter((i) => LISTED.has(i.where)).sort(order)
  const drafts = new Map(snap.drafts.map((d) => [d.id, d]))
  const phoneItem = (i: Item, group: PhoneItem['group']) =>
    pick<PhoneItem>({
      id: i.sessionId,
      kind: i.kind,
      title: i.name,
      project: i.key,
      account: i.account,
      group,
      state: i.state,
      activeAt: i.activeAt,
      model: i.model,
      effort: i.effort,
      nextAt: i.nextAt,
      unread: i.unread,
      waiting: i.waiting,
      queue: i.queue,
      attach: i.kind === 'background' && !!i.id ? true : undefined,
      text: i.kind === 'draft' ? drafts.get(i.draft ?? '')?.text : undefined,
      worktree: i.kind === 'draft' ? i.worktree : undefined,
      picked: i.kind === 'draft' && i.picked ? true : undefined,
    })
  const items = listed.map((i) => phoneItem(i, groupOf(i)))
  const archived = snap.items
    .filter((i) => i.where === 'done')
    .sort((a, b) => b.activeAt - a.activeAt)
    .slice(0, ARCHIVED_SENT)
    .map((i) => phoneItem(i, 'archived'))
  const count = (pred: (i: Item) => boolean) => listed.filter(pred).length
  const accounts = snap.accounts.map((a) =>
    pick<PhoneAccount>({
      name: a.account.name,
      label: a.account.label,
      color: color(a.account.name),
      email: a.auth?.email,
      plan: a.auth?.subscriptionType,
      local: isLocal(a.account),
      signedIn: !!a.auth?.loggedIn,
      session: a.usage?.fiveHour ?? undefined,
      week: a.usage?.sevenDay ?? undefined,
      usageAt: a.usage?.fetchedAt,
      running: count((i) => i.account === a.account.name && groupOf(i) === 'running'),
      waiting: count((i) => i.account === a.account.name && groupOf(i) === 'waiting'),
    }),
  )
  const projects = snap.projects.map((p) => ({
    key: p.key,
    open: snap.openCounts.get(p.key) ?? null,
    running: count((i) => i.key === p.key && groupOf(i) === 'running'),
    waiting: count((i) => i.key === p.key && groupOf(i) === 'waiting'),
  }))
  return { t: 'snapshot', at: snap.at, mac, items, archived, accounts, projects }
}
