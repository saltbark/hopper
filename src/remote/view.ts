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
  group: ReturnType<typeof groupOf>
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
  accounts: PhoneAccount[]
  projects: PhoneProject[]
}

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
  const items = listed.map((i) =>
    pick<PhoneItem>({
      id: i.sessionId,
      kind: i.kind,
      title: i.name,
      project: i.key,
      account: i.account,
      group: groupOf(i),
      state: i.state,
      activeAt: i.activeAt,
      model: i.model,
      effort: i.effort,
      nextAt: i.nextAt,
      unread: i.unread,
      waiting: i.waiting,
      queue: i.queue,
      attach: i.kind === 'background' && !!i.id ? true : undefined,
    }),
  )
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
  return { t: 'snapshot', at: snap.at, mac, items, accounts, projects }
}
