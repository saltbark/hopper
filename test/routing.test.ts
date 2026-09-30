import { describe, expect, it } from 'vitest'

import {
  addAccount,
  OVERNIGHT_DEFAULTS,
  parsePrefixList,
  setPrefixes,
  type Config,
} from '../src/config.ts'
import type { AccountState } from '../src/model.ts'
import { hasRoom, pickAccount, routeFor } from '../src/routing.ts'

let config: Config = {
  path: '',
  accountsPath: '',
  home: '/h',
  accounts: [],
  routes: [],
  overnight: OVERNIGHT_DEFAULTS,
}
for (const [name, dir] of [
  ['bh', null],
  ['bh2', '/d/bh2'],
  ['pm', '/d/pm'],
] as const) {
  config = addAccount(config, { name, label: name, configDir: dir })
}
config = setPrefixes(config, 'bh', ['bh/'])
config = setPrefixes(config, 'bh2', ['bh/', 'bh/news/'])
config = setPrefixes(config, 'pm', parsePrefixList('pm/, *'))

const future = new Date(Date.now() + 86_400_000).toISOString()
const past = new Date(Date.now() - 86_400_000).toISOString()
const state = (
  name: string,
  loggedIn: boolean,
  weekPct?: number,
  resetsAt = future,
): AccountState => ({
  account: config.accounts.find((a) => a.name === name)!,
  auth: { loggedIn },
  authError: null,
  usage:
    weekPct === undefined
      ? null
      : { fiveHour: null, sevenDay: { pct: weekPct, resetsAt }, fetchedAt: Date.now() },
  sessionError: null,
  sessions: [],
  sessionsAt: null,
  counts: { queue: 0, needs: 0, done: 0, live: 0 },
})

describe('routeFor', () => {
  it('uses the longest prefix, falls back to *, and matches a key equal to the prefix', () => {
    expect(routeFor(config, 'bh/news/bulletin')?.prefix).toBe('bh/news/')
    expect(routeFor(config, 'bh/atlas')?.prefix).toBe('bh/')
    expect(routeFor(config, 'bh')?.prefix).toBe('bh/')
    expect(routeFor(config, 'meta/inbox')?.prefix).toBe('')
  })
})

describe('hasRoom', () => {
  it('needs a signed-in account under its limits; unknown or out-of-date usage counts as room', () => {
    expect(hasRoom(state('bh', false))).toBe(false)
    expect(hasRoom(state('bh', true))).toBe(true)
    expect(hasRoom(state('bh', true, 97))).toBe(false)
    expect(hasRoom(state('bh', true, 97, past))).toBe(true)
  })
})

describe('pickAccount', () => {
  it('takes the first account on the route with room', () => {
    const p = pickAccount(config, 'bh/atlas', [state('bh', true, 50), state('bh2', true, 10)])
    expect(p.account?.name).toBe('bh')
  })
  it('moves to the next when the first is full or signed out', () => {
    expect(
      pickAccount(config, 'bh/atlas', [state('bh', true, 99), state('bh2', true, 10)]).account
        ?.name,
    ).toBe('bh2')
    expect(
      pickAccount(config, 'bh/atlas', [state('bh', false), state('bh2', true)]).account?.name,
    ).toBe('bh2')
  })
  it('falls back to a full account rather than none, and says so', () => {
    const p = pickAccount(config, 'bh/atlas', [state('bh', true, 99), state('bh2', true, 98)])
    expect(p.account?.name).toBe('bh')
    expect(p.reason).toMatch(/near its limit/)
  })
  it('reports when nothing can run a key', () => {
    const none = { ...config, routes: [] }
    expect(pickAccount(none, 'bh/atlas', []).account).toBeUndefined()
    expect(pickAccount(config, 'pm/ledger', [state('pm', false)]).reason).toMatch(/signed in/)
  })
})

describe('a single account', () => {
  it('runs everything while there are no routes, once it is signed in', () => {
    let one: Config = {
      path: '',
      accountsPath: '',
      home: '/h',
      accounts: [],
      routes: [],
      overnight: OVERNIGHT_DEFAULTS,
    }
    one = addAccount(one, { name: 'bh', label: 'bh', configDir: null })
    const st = (loggedIn: boolean): AccountState => ({
      ...state('bh', loggedIn),
      account: one.accounts[0]!,
    })
    expect(pickAccount(one, 'meta/inbox', [st(true)]).account?.name).toBe('bh')
    expect(pickAccount(one, 'meta/inbox', [st(false)]).account).toBeUndefined()
  })
})
