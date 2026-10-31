import { describe, expect, it } from 'vitest'

import {
  addAccount,
  OVERNIGHT_DEFAULTS,
  parsePrefixList,
  setPrefixes,
  type Config,
} from '../src/config.ts'
import type { AccountState } from '../src/model.ts'
import { accountsFor, hasRoom, pickAccount, routeFor } from '../src/routing.ts'

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

describe('a local account', () => {
  const lo = {
    name: 'lo',
    label: 'lo',
    configDir: '/d/lo',
    provider: 'ollama' as const,
    local: { baseUrl: 'http://x', model: 'tern', context: 131072, concurrency: 1 },
  }
  const withLocal = addAccount(config, lo)
  const st = (name: string, loggedIn: boolean, reason?: string): AccountState => ({
    ...state(name === 'lo' ? 'bh' : name, loggedIn),
    account: withLocal.accounts.find((a) => a.name === name)!,
    auth: {
      loggedIn,
      ...(name === 'lo' ? { local: { model: 'tern', ...(reason ? { reason } : {}) } } : {}),
    },
  })
  it('runs only work whose model is local, and never takes a login’s overflow', () => {
    const states = [st('bh', true), st('bh2', true), st('lo', true)]
    expect(pickAccount(withLocal, 'bh/atlas', states, 'local').account?.name).toBe('lo')
    expect(pickAccount(withLocal, 'bh/atlas', states, 'opus').account?.name).toBe('bh')
    const full = [{ ...st('bh', false) }, st('bh2', false), st('lo', true)]
    expect(pickAccount(withLocal, 'bh/atlas', full, 'opus').account).toBeUndefined()
  })
  it('says why when its server is down, and when there is none', () => {
    const p = pickAccount(
      withLocal,
      'bh/atlas',
      [st('lo', false, 'Ollama isn’t answering')],
      'local',
    )
    expect(p.account).toBeUndefined()
    expect(p.reason).toMatch(/isn’t answering/)
    expect(pickAccount(config, 'bh/atlas', [], 'local').reason).toMatch(/no local account/)
  })
  it('lists only local accounts for local work, and only logins for the rest', () => {
    expect(accountsFor(withLocal, 'pm/ledger', 'local').names).toEqual(['lo'])
    expect(accountsFor(withLocal, 'pm/ledger', 'sonnet').names).toEqual(['pm'])
  })
})

describe('an account picked by hand', () => {
  it('wins over the route, full or not, while it is signed in', () => {
    const states = [state('bh', true), state('pm', true, 99)]
    const p = pickAccount(config, 'bh/atlas', states, 'opus', 'pm')
    expect(p.account?.name).toBe('pm')
    expect(pickAccount(config, 'bh/atlas', [state('pm', false)], 'opus', 'pm').reason).toMatch(
      /pm is not signed in/,
    )
  })
  it('must be the right kind for the model', () => {
    expect(accountsFor(config, 'bh/atlas', 'local', 'pm').none).toMatch(/doesn't run local/)
    expect(accountsFor(config, 'bh/atlas', 'opus', 'zz').none).toMatch(/no account zz/)
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
