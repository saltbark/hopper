import { spawn } from 'node:child_process'
import { readlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { readIfThere, writeJson } from './fsutil.ts'
import { isRelease, version } from './version.ts'

// Updating a release copy (one install.sh put in ~/.hopper/app). The site publishes the latest
// release as latest.json, written when it is deployed after each release; the open app asks for
// it now and then and says when there's a newer one, and install.sh is what installs it, from the
// app (V) or from `hopper update`. A copy built from git never asks: it updates with git.

const SITE = process.env['HOPPER_SITE'] ?? 'https://hopper.saltbark.com'
// Where install.sh puts releases: one folder per version and `current`, a link to the one in use.
export const APP_DIR = join(homedir(), '.hopper', 'app')
// The site is asked at most this often; the answer is kept in <home>/state/update.json between.
export const CHECK_EVERY = 6 * 60 * 60_000

// What latest.json says: the version, and its lines in CHANGELOG.md.
export type Latest = { version: string; notes: string[] }

// What the app shows at the bottom right: a newer release, being installed, or installed and
// waiting for Hopper to be opened again.
export type Update = Latest & { stage: 'available' | 'installing' | 'installed' }

// What the app checks and installs with. Tests pass their own.
export type Updater = {
  // A newer release than this one, or null. `force` asks the site even if it was asked lately.
  check: (home: string, force?: boolean) => Promise<Update | null>
  install: (version: string) => Promise<void>
}

const parts = (v: string) => (/^v?(\d+)\.(\d+)\.(\d+)/.exec(v) ?? []).slice(1, 4).map(Number)

// Whether version a comes after b. Anything that isn't x.y.z is never newer.
export function newer(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)]
  if (x.length < 3 || y.length < 3) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!
  return false
}

export async function fetchLatest(): Promise<Latest | null> {
  try {
    const r = await fetch(`${SITE}/latest.json`, { signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const raw = (await r.json()) as { version?: unknown; notes?: unknown }
    if (typeof raw.version !== 'string' || parts(raw.version).length < 3) return null
    const notes = Array.isArray(raw.notes) ? raw.notes.filter((n) => typeof n === 'string') : []
    return { version: raw.version, notes }
  } catch {
    return null
  }
}

const cacheFile = (home: string) => join(home, 'state', 'update.json')
type Cache = { checkedAt: number; latest: Latest | null }

// The latest release, from the site at most every CHECK_EVERY, else from the last answer.
export async function latest(
  home: string,
  force = false,
  now = Date.now(),
): Promise<Latest | null> {
  let cache: Cache | null = null
  try {
    cache = JSON.parse((await readIfThere(cacheFile(home))) ?? 'null') as Cache | null
  } catch {}
  if (!force && cache && now - cache.checkedAt < CHECK_EVERY) return cache.latest
  const fetched = await fetchLatest()
  // A failed ask keeps the last answer, and is tried again next time rather than in six hours.
  if (!fetched) return cache?.latest ?? null
  await writeJson(cacheFile(home), { checkedAt: now, latest: fetched } satisfies Cache).catch(
    () => {},
  )
  return fetched
}

// The version ~/.hopper/app/current points at: newer than the one running once an update is in,
// from the app or from `hopper update` in another window.
export async function installedVersion(dir = APP_DIR): Promise<string | null> {
  try {
    return await readlink(join(dir, 'current'))
  } catch {
    return null
  }
}

// Runs install.sh for `version` (null: the latest), fetched from the site as the README's
// one-liner does. `quiet` keeps its output, for the app, and fails with its last line; otherwise
// it prints.
export async function runInstaller(version: string | null, quiet: boolean): Promise<void> {
  const r = await fetch(`${SITE}/install.sh`, { signal: AbortSignal.timeout(30_000) }).catch(
    () => null,
  )
  if (!r?.ok) throw new Error(`couldn't download ${SITE}/install.sh`)
  const script = await r.text()
  await new Promise<void>((resolve, reject) => {
    const child = spawn('sh', ['-s'], {
      env: { ...process.env, ...(version ? { HOPPER_VERSION: version } : {}) },
      stdio: ['pipe', quiet ? 'pipe' : 'inherit', quiet ? 'pipe' : 'inherit'],
    })
    let out = ''
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) return resolve()
      const last = out
        .trim()
        .split('\n')
        .at(-1)
        ?.replace(/^hopper: /, '')
      reject(new Error(last || `install.sh stopped (${code})`))
    })
    child.stdin!.end(script)
  })
}

// The real one, for a release copy. A copy built from git has none, and never asks.
export function releaseUpdater(): Updater | null {
  if (!isRelease() || process.env['HOPPER_NO_UPDATE_CHECK']) return null
  return {
    check: async (home, force) => {
      const running = version()
      // Installed already, and not yet running: say so, whatever the site says.
      const installed = await installedVersion()
      const known = await latest(home, force)
      if (installed && newer(installed, running)) {
        const notes = known?.version === installed ? known.notes : []
        return { version: installed, notes, stage: 'installed' }
      }
      return known && newer(known.version, running) ? { ...known, stage: 'available' } : null
    },
    install: (v) => runInstaller(v, true),
  }
}
