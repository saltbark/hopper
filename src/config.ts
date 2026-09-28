import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { parse, stringify } from 'smol-toml'

import { readIfThere, writeAtomic } from './fsutil.ts'
import { configPath, expandHome, tildify } from './paths.ts'

// Which tool an account drives. Only Claude Code exists today; the field is here so other agent
// CLIs, other clouds and local models can join without rewriting accounts.toml.
export const PROVIDERS = ['claude-code'] as const
export type Provider = (typeof PROVIDERS)[number]

// An account. For Claude Code, `configDir` null means the default login, which must run with
// CLAUDE_CONFIG_DIR unset (see claude.ts).
export type Account = { name: string; label: string; configDir: string | null; provider?: Provider }

// Work under `prefix` runs on the first of `accounts` that is signed in and has room.
// The empty prefix matches every key.
export type Route = { prefix: string; accounts: string[] }

export type Config = {
  path: string
  accountsPath: string
  home: string
  accounts: Account[]
  routes: Route[]
}

export const DEFAULT_CONFIG = `# Hopper settings. The home folder holds Hopper's own state: the project list, the queue order,
# conversations marked done and its log. It is not a git repo.
home = "~/Dropbox/Workspace/hopper"

# Claude accounts and which prefixes they run are in accounts.toml, next to this file. Hopper
# writes it; manage them from the app (a), or edit it by hand.
`

const ACCOUNTS_HEADER = `# Written by Hopper. Manage from the app (a, for Accounts), or edit by hand.
# config_dir = "default" is the login Claude Code uses with CLAUDE_CONFIG_DIR unset.
# A route sends work under a prefix to the first of its accounts that is signed in and has room.

`

const NAME = /^[a-z0-9][a-z0-9-]{0,11}$/

export class ConfigError extends Error {}

// Accounts are kept in alphabetical order, so every list of them reads the same.
const byName = (a: Account, b: Account) => a.name.localeCompare(b.name)

function tomlError(path: string, e: unknown): ConfigError {
  return new ConfigError(`${tildify(path)}: ${(e as Error).message}`)
}

export function parseSettings(text: string, path: string): { home: string } {
  let raw: Record<string, unknown>
  try {
    raw = parse(text) as Record<string, unknown>
  } catch (e) {
    throw tomlError(path, e)
  }
  const home = raw['home']
  if (typeof home !== 'string' || !home)
    throw new ConfigError(`${tildify(path)}: "home" must be a path`)
  return { home: expandHome(home) }
}

export function parseAccounts(
  text: string,
  path: string,
): { accounts: Account[]; routes: Route[] } {
  let raw: Record<string, unknown>
  try {
    raw = parse(text) as Record<string, unknown>
  } catch (e) {
    throw tomlError(path, e)
  }
  const where = tildify(path)
  const accounts: Account[] = []
  for (const entry of Array.isArray(raw['account']) ? raw['account'] : []) {
    const a = (entry ?? {}) as Record<string, unknown>
    const name = a['name']
    if (typeof name !== 'string' || !NAME.test(name)) {
      throw new ConfigError(`${where}: account names are 1-12 lowercase letters, digits or hyphens`)
    }
    if (accounts.some((x) => x.name === name))
      throw new ConfigError(`${where}: "${name}" appears twice`)
    const dir = typeof a['config_dir'] === 'string' ? a['config_dir'] : 'default'
    const provider = a['provider'] ?? 'claude-code'
    if (!PROVIDERS.includes(provider as Provider)) {
      throw new ConfigError(
        `${where}: ${name} uses provider "${String(provider)}"; this Hopper knows ${PROVIDERS.join(', ')}`,
      )
    }
    accounts.push({
      name,
      label: typeof a['label'] === 'string' && a['label'] ? a['label'] : name,
      configDir: dir === 'default' ? null : expandHome(dir),
    })
  }
  accounts.sort(byName)
  if (accounts.filter((a) => a.configDir === null).length > 1) {
    throw new ConfigError(`${where}: only one account can use config_dir = "default"`)
  }
  const routes: Route[] = []
  for (const entry of Array.isArray(raw['route']) ? raw['route'] : []) {
    const r = (entry ?? {}) as Record<string, unknown>
    const prefix = typeof r['prefix'] === 'string' ? r['prefix'] : null
    const names = Array.isArray(r['accounts'])
      ? r['accounts'].filter((n): n is string => typeof n === 'string')
      : []
    if (prefix === null) throw new ConfigError(`${where}: every [[route]] needs a prefix`)
    for (const n of names) {
      if (!accounts.some((a) => a.name === n))
        throw new ConfigError(`${where}: route "${prefix}" names an unknown account "${n}"`)
    }
    if (routes.some((x) => x.prefix === prefix))
      throw new ConfigError(`${where}: route "${prefix}" appears twice`)
    if (names.length) routes.push({ prefix, accounts: names })
  }
  return { accounts, routes }
}

export function serializeAccounts(config: Pick<Config, 'accounts' | 'routes'>): string {
  const doc: Record<string, unknown> = {}
  if (config.accounts.length) {
    doc['account'] = config.accounts.map((a) => ({
      name: a.name,
      provider: a.provider ?? 'claude-code',
      label: a.label,
      config_dir: a.configDir === null ? 'default' : tildify(a.configDir),
    }))
  }
  if (config.routes.length) {
    doc['route'] = config.routes.map((r) => ({ prefix: r.prefix, accounts: r.accounts }))
  }
  const body = stringify(doc)
  return ACCOUNTS_HEADER + body + (body && !body.endsWith('\n') ? '\n' : '')
}

export const accountsPathFor = (path: string) => join(dirname(path), 'accounts.toml')

export async function loadConfig(path = configPath()): Promise<Config | null> {
  const text = await readIfThere(path)
  if (text === null) return null
  const accountsPath = accountsPathFor(path)
  const accountsText = await readIfThere(accountsPath)
  const { accounts, routes } =
    accountsText === null ? { accounts: [], routes: [] } : parseAccounts(accountsText, accountsPath)
  return { path, accountsPath, ...parseSettings(text, path), accounts, routes }
}

// Writes the default settings unless they exist. Returns whether it wrote.
export async function writeDefaultConfig(path = configPath()): Promise<boolean> {
  if ((await readIfThere(path)) !== null) return false
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, DEFAULT_CONFIG, { flag: 'wx' })
  return true
}

export const saveAccounts = (config: Config) =>
  writeAtomic(config.accountsPath, serializeAccounts(config))

// ---------- edits: each returns a new Config, or throws ConfigError with a message for the user ----------

export function addAccount(config: Config, account: Account): Config {
  if (!NAME.test(account.name))
    throw new ConfigError('Use 1-12 lowercase letters, digits or hyphens.')
  if (config.accounts.some((a) => a.name === account.name))
    throw new ConfigError(`"${account.name}" is taken.`)
  const clash = config.accounts.find((a) => a.configDir === account.configDir)
  if (clash)
    throw new ConfigError(
      `${clash.name} already uses ${account.configDir === null ? 'the default login' : tildify(account.configDir)}.`,
    )
  return { ...config, accounts: [...config.accounts, account].sort(byName) }
}

export function removeAccount(config: Config, name: string): Config {
  return {
    ...config,
    accounts: config.accounts.filter((a) => a.name !== name),
    routes: config.routes
      .map((r) => ({ ...r, accounts: r.accounts.filter((n) => n !== name) }))
      .filter((r) => r.accounts.length),
  }
}

export function relabel(config: Config, name: string, label: string): Config {
  return {
    ...config,
    accounts: config.accounts.map((a) =>
      a.name === name ? { ...a, label: label.trim() || a.name } : a,
    ),
  }
}

// "kf/, meta" → ["kf/", "meta/"]; "*" means every key.
export function parsePrefixList(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/[,\s]+/)) {
    const p = raw.trim()
    if (!p) continue
    const prefix = p === '*' ? '' : p.endsWith('/') ? p : p + '/'
    if (prefix && !/^[a-z0-9-]+(\/[a-z0-9-]+)*\/$/.test(prefix))
      throw new ConfigError(`"${p}" is not a prefix like kf/ or kf/aas/.`)
    if (!out.includes(prefix)) out.push(prefix)
  }
  return out
}

export const showPrefix = (p: string) => (p === '' ? '*' : p)

export function prefixesOf(config: Config, name: string): { prefix: string; rank: number }[] {
  return config.routes.flatMap((r) => {
    const rank = r.accounts.indexOf(name)
    return rank < 0 ? [] : [{ prefix: r.prefix, rank }]
  })
}

// Makes `prefixes` exactly the routes this account is on. New routes put it last, so an
// account joining a pool doesn't jump the queue; `preferFirst` does that on purpose.
export function setPrefixes(config: Config, name: string, prefixes: string[]): Config {
  const routes = config.routes
    .map((r) => {
      const has = r.accounts.includes(name)
      const wants = prefixes.includes(r.prefix)
      if (has && !wants) return { ...r, accounts: r.accounts.filter((n) => n !== name) }
      if (!has && wants) return { ...r, accounts: [...r.accounts, name] }
      return r
    })
    .filter((r) => r.accounts.length)
  for (const p of prefixes)
    if (!routes.some((r) => r.prefix === p)) routes.push({ prefix: p, accounts: [name] })
  routes.sort((a, b) => a.prefix.localeCompare(b.prefix))
  return { ...config, routes }
}

// The default account runs any key no other route covers: it is the route for "" (every key).
export function defaultAccount(config: Config): string | undefined {
  return config.routes.find((r) => r.prefix === '')?.accounts[0]
}

export function setDefaultAccount(config: Config, name: string): Config {
  if (!config.accounts.some((a) => a.name === name)) throw new ConfigError(`No account "${name}".`)
  const others = config.routes.filter((r) => r.prefix !== '')
  const current =
    config.routes.find((r) => r.prefix === '')?.accounts.filter((n) => n !== name) ?? []
  return { ...config, routes: [{ prefix: '', accounts: [name, ...current] }, ...others] }
}

// How a prefix reads to a person: the empty one is everything no other route covers.
export const describePrefix = (p: string) => (p === '' ? 'default' : p)

export function preferFirst(config: Config, name: string): Config {
  return {
    ...config,
    routes: config.routes.map((r) =>
      r.accounts.includes(name)
        ? { ...r, accounts: [name, ...r.accounts.filter((n) => n !== name)] }
        : r,
    ),
  }
}

// A short name from what the login says about itself: "Knowledge Futures" → kf.
export function suggestName(
  hint: { orgName?: string; email?: string } | null,
  taken: string[],
): string {
  const words = (hint?.orgName ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []
  let base =
    words.length >= 2
      ? words.map((w) => w[0]).join('')
      : (
          words[0] ??
          hint?.email
            ?.split('@')[0]
            ?.toLowerCase()
            .replace(/[^a-z0-9]/g, '') ??
          ''
        ).slice(0, 6)
  if (!base) base = 'claude'
  base = base.slice(0, 10)
  if (!taken.includes(base)) return base
  for (let i = 2; ; i++) if (!taken.includes(`${base}${i}`)) return `${base}${i}`
}
