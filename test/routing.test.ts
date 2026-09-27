import { describe, expect, it } from 'vitest'

import { addAccount, parsePrefixList, setPrefixes, type Config } from '../src/config.ts'
import type { AccountState } from '../src/model.ts'
import { hasRoom, pickAccount, routeFor } from '../src/routing.ts'

let config: Config = { path: '', accountsPath: '', home: '/h', accounts: [], routes: [] }
for (const [name, dir] of [
  ['kf', null],
  ['kf2', '/d/kf2'],
  ['sb', '/d/sb'],
] as const) {
  config = addAccount(config, { name, label: name, configDir: dir })
}
config = setPrefixes(config, 'kf', ['kf/'])
config = setPrefixes(config, 'kf2', ['kf/', 'kf/aas/'])
config = setPrefixes(config, 'sb', parsePrefixList('sb/, *'))

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
  counts: { queue: 0, needs: 0, done: 0, live: 0 },
})

describe('routeFor', () => {
  it('uses the longest prefix, falls back to *, and matches a key equal to the prefix', () => {
    expect(routeFor(config, 'kf/aas/bulletin')?.prefix).toBe('kf/aas/')
    expect(routeFor(config, 'kf/console')?.prefix).toBe('kf/')
    expect(routeFor(config, 'kf')?.prefix).toBe('kf/')
    expect(routeFor(config, 'meta/inbox')?.prefix).toBe('')
  })
})

describe('hasRoom', () => {
  it('needs a signed-in account under its limits; unknown or out-of-date usage counts as room', () => {
    expect(hasRoom(state('kf', false))).toBe(false)
    expect(hasRoom(state('kf', true))).toBe(true)
    expect(hasRoom(state('kf', true, 97))).toBe(false)
    expect(hasRoom(state('kf', true, 97, past))).toBe(true)
  })
})

describe('pickAccount', () => {
  it('takes the first account on the route with room', () => {
    const p = pickAccount(config, 'kf/console', [state('kf', true, 50), state('kf2', true, 10)])
    expect(p.account?.name).toBe('kf')
  })
  it('moves to the next when the first is full or signed out', () => {
    expect(
      pickAccount(config, 'kf/console', [state('kf', true, 99), state('kf2', true, 10)]).account
        ?.name,
    ).toBe('kf2')
    expect(
      pickAccount(config, 'kf/console', [state('kf', false), state('kf2', true)]).account?.name,
    ).toBe('kf2')
  })
  it('falls back to a full account rather than none, and says so', () => {
    const p = pickAccount(config, 'kf/console', [state('kf', true, 99), state('kf2', true, 98)])
    expect(p.account?.name).toBe('kf')
    expect(p.reason).toMatch(/near its limit/)
  })
  it('reports when nothing can run a key', () => {
    const none = { ...config, routes: [] }
    expect(pickAccount(none, 'kf/console', []).account).toBeUndefined()
    expect(pickAccount(config, 'sb/crum', [state('sb', false)]).reason).toMatch(/signed in/)
  })
})

describe('a single account', () => {
  it('runs everything while there are no routes, once it is signed in', () => {
    let one: Config = { path: '', accountsPath: '', home: '/h', accounts: [], routes: [] }
    one = addAccount(one, { name: 'kf', label: 'kf', configDir: null })
    const st = (loggedIn: boolean): AccountState => ({
      ...state('kf', loggedIn),
      account: one.accounts[0]!,
    })
    expect(pickAccount(one, 'meta/inbox', [st(true)]).account?.name).toBe('kf')
    expect(pickAccount(one, 'meta/inbox', [st(false)]).account).toBeUndefined()
  })
})
