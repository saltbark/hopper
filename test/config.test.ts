import { homedir } from 'node:os'

import { describe, expect, it } from 'vitest'

import {
  addAccount,
  ConfigError,
  parseAccounts,
  parsePrefixList,
  parseSettings,
  preferFirst,
  prefixesOf,
  removeAccount,
  serializeAccounts,
  setPrefixes,
  suggestName,
  type Config,
} from '../src/config.ts'

const base = (): Config => ({
  path: '/c/config.toml',
  accountsPath: '/c/accounts.toml',
  home: '/h',
  accounts: [],
  routes: [],
})
const two = (): Config => {
  let c = addAccount(base(), { name: 'kf', label: 'KF', configDir: null })
  c = addAccount(c, { name: 'kf2', label: 'KF two', configDir: '/x/.claude-kf2' })
  return setPrefixes(setPrefixes(c, 'kf', ['kf/', 'meta/']), 'kf2', ['kf/'])
}

describe('settings', () => {
  it('reads home and expands ~', () => {
    expect(parseSettings('home = "~/hop"', '/c.toml').home).toBe(`${homedir()}/hop`)
  })
  it('reports TOML errors with the path', () => {
    expect(() => parseSettings('home = ', '/c.toml')).toThrow(/c\.toml/)
  })
})

describe('accounts.toml', () => {
  it('round-trips accounts and routes', () => {
    const c = two()
    const back = parseAccounts(serializeAccounts(c), '/c/accounts.toml')
    expect(back).toEqual({ accounts: c.accounts, routes: c.routes })
    expect(serializeAccounts(c)).toContain('config_dir = "default"')
  })
  it('is empty when there is nothing in it', () => {
    expect(parseAccounts('', '/a.toml')).toEqual({ accounts: [], routes: [] })
  })
  it('rejects a route to an unknown account, and two default logins', () => {
    expect(() =>
      parseAccounts('[[route]]\nprefix = "kf/"\naccounts = ["nope"]\n', '/a.toml'),
    ).toThrow(/unknown account/)
    const twoDefaults =
      '[[account]]\nname = "a"\nconfig_dir = "default"\n[[account]]\nname = "b"\nconfig_dir = "default"\n'
    expect(() => parseAccounts(twoDefaults, '/a.toml')).toThrow(/only one account/)
  })
})

describe('edits', () => {
  it('refuses a taken name or a directory another account uses', () => {
    const c = two()
    expect(() => addAccount(c, { name: 'kf', label: '', configDir: '/y' })).toThrow(ConfigError)
    expect(() => addAccount(c, { name: 'sb', label: '', configDir: null })).toThrow(/default login/)
    expect(() => addAccount(c, { name: 'Bad Name', label: '', configDir: '/z' })).toThrow(
      /lowercase/,
    )
  })
  it('puts an account joining a route last, and preferFirst moves it up', () => {
    const c = two()
    expect(c.routes).toEqual([
      { prefix: 'kf/', accounts: ['kf', 'kf2'] },
      { prefix: 'meta/', accounts: ['kf'] },
    ])
    expect(preferFirst(c, 'kf2').routes[0]).toEqual({ prefix: 'kf/', accounts: ['kf2', 'kf'] })
    expect(prefixesOf(c, 'kf2')).toEqual([{ prefix: 'kf/', rank: 1 }])
  })
  it('setPrefixes takes an account off routes it no longer lists, and drops empty routes', () => {
    const c = setPrefixes(two(), 'kf', ['kf/'])
    expect(c.routes).toEqual([{ prefix: 'kf/', accounts: ['kf', 'kf2'] }])
  })
  it('removing an account takes it off every route', () => {
    const c = removeAccount(two(), 'kf')
    expect(c.accounts.map((a) => a.name)).toEqual(['kf2'])
    expect(c.routes).toEqual([{ prefix: 'kf/', accounts: ['kf2'] }])
  })
})

describe('parsePrefixList', () => {
  it('normalises, dedupes, and reads * as everything', () => {
    expect(parsePrefixList('kf, kf/aas/  meta/, kf/, *')).toEqual(['kf/', 'kf/aas/', 'meta/', ''])
  })
  it('rejects things that are not prefixes', () => {
    expect(() => parsePrefixList('KF Stuff')).toThrow(ConfigError)
  })
})

describe('suggestName', () => {
  it('uses the org initials, the email, or claude, and avoids taken names', () => {
    expect(suggestName({ orgName: 'Knowledge Futures' }, [])).toBe('kf')
    expect(suggestName({ orgName: 'Knowledge Futures' }, ['kf'])).toBe('kf2')
    expect(suggestName({ orgName: 'Saltbark' }, [])).toBe('saltba')
    expect(suggestName({ email: 'travis@x.org' }, [])).toBe('travis')
    expect(suggestName(null, [])).toBe('claude')
  })
})

describe('providers', () => {
  it('defaults to claude-code, writes it out, and refuses one this build does not know', () => {
    const c = parseAccounts('[[account]]\nname = "kf"\n', '/a.toml')
    expect(serializeAccounts({ ...c })).toContain('provider = "claude-code"')
    expect(() =>
      parseAccounts('[[account]]\nname = "local"\nprovider = "ollama"\n', '/a.toml'),
    ).toThrow(/knows claude-code/)
  })
})

describe('the default account', () => {
  it('runs every key no other route names, and can be changed', async () => {
    const { defaultAccount, setDefaultAccount } = await import('../src/config.ts')
    const { routeFor } = await import('../src/routing.ts')
    let c = two()
    expect(defaultAccount(c)).toBeUndefined()
    c = setDefaultAccount(c, 'kf2')
    expect(defaultAccount(c)).toBe('kf2')
    expect(routeFor(c, 'sb/crum')?.accounts).toEqual(['kf2'])
    expect(routeFor(c, 'kf/console')?.prefix).toBe('kf/') // a named route still wins
    c = setDefaultAccount(c, 'kf')
    expect(c.routes.find((r) => r.prefix === '')?.accounts).toEqual(['kf', 'kf2'])
    expect(() => setDefaultAccount(c, 'nope')).toThrow(/No account/)
  })
})

describe('account order', () => {
  it('keeps accounts alphabetical, as read and as added', async () => {
    const { addAccount, parseAccounts } = await import('../src/config.ts')
    const read = parseAccounts(
      '[[account]]\nname = "sb"\nconfig_dir = "~/.claude-sb"\n[[account]]\nname = "kf"\n',
      '/c/accounts.toml',
    )
    expect(read.accounts.map((a) => a.name)).toEqual(['kf', 'sb'])
    const config = { path: '', accountsPath: '', home: '', ...read }
    const added = addAccount(config, { name: 'gt', label: 'gt', configDir: '/tmp/gt' })
    expect(added.accounts.map((a) => a.name)).toEqual(['gt', 'kf', 'sb'])
  })
})
