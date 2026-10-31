import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { startBackground } from '../src/claude.ts'
import type { Account, Local } from '../src/config.ts'
import { localAuth, localStatus, settingsPath, writeLocalSettings } from '../src/local.ts'
import { fakeClaude } from './helpers.ts'

const local: Local = {
  baseUrl: 'http://localhost:11434',
  model: 'tern:27b',
  context: 131072,
  concurrency: 1,
}

// A stand-in server: each path answers with its JSON, anything else with a 404.
const server =
  (routes: Record<string, unknown>): typeof fetch =>
  async (input) => {
    const path = new URL(String(input)).pathname
    return path in routes
      ? new Response(JSON.stringify(routes[path]))
      : new Response('', { status: 404 })
  }
const down: typeof fetch = async () => {
  throw new TypeError('fetch failed')
}

describe('a local account’s settings', () => {
  it('point Claude Code at the server and its model, keeping what else is there', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hopper-lo-'))
    await writeFile(settingsPath(dir), JSON.stringify({ theme: 'dark', env: { MINE: '1' } }))
    await writeLocalSettings(dir, local)
    const s = JSON.parse(await readFile(settingsPath(dir), 'utf8'))
    expect(s.theme).toBe('dark')
    expect(s.env).toMatchObject({
      MINE: '1',
      ANTHROPIC_BASE_URL: 'http://localhost:11434',
      ANTHROPIC_MODEL: 'tern:27b',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'tern:27b',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '131072',
    })
  })
  it('leave a settings file that is not JSON alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hopper-lo-'))
    await writeFile(settingsPath(dir), '{ half')
    await expect(writeLocalSettings(dir, local)).rejects.toThrow(/isn't JSON/)
    expect(await readFile(settingsPath(dir), 'utf8')).toBe('{ half')
  })
})

describe('a local account’s status', () => {
  it('is ready when the server has the model, and says what is loaded', async () => {
    const s = await localStatus(
      local,
      server({
        '/api/tags': { models: [{ name: 'tern:27b' }] },
        '/api/ps': { models: [{ name: 'tern:27b', size_vram: 18e9, context_length: 65536 }] },
      }),
    )
    expect(s).toEqual({
      model: 'tern:27b',
      loaded: { context: 65536, bytes: 18e9, expiresAt: null },
    })
  })
  it('reads a bare name as :latest', async () => {
    const s = await localStatus(
      { ...local, model: 'tern' },
      server({ '/api/tags': { models: [{ name: 'tern:latest' }] }, '/api/ps': { models: [] } }),
    )
    expect(s.reason).toBeUndefined()
  })
  it('says why not when the server is down or lacks the model, and is then signed out', async () => {
    expect(await localStatus(local, down)).toMatchObject({ offline: true, reason: /isn't running/ })
    const none = server({ '/api/tags': { models: [{ name: 'other' }] } })
    expect((await localStatus(local, none)).reason).toMatch(/no tern:27b/)
    const account = { name: 'lo', label: 'lo', configDir: null, local }
    expect(await localAuth(account, down)).toMatchObject({ loggedIn: false })
  })
})

describe('starting on a local account', () => {
  afterEach(() => {
    delete process.env['HOPPER_CLAUDE']
  })
  it('runs its own model, with no effort or Remote Control, and its settings in place', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hopper-lo-'))
    const log = join(dir, 'args.log')
    process.env['HOPPER_CLAUDE'] = await fakeClaude(
      `printf '%s\\n' "$@" > "${log}"\necho "backgrounded · a1b2c3d4 · x"`,
      dir,
    )
    const account: Account = {
      name: 'lo',
      label: 'lo',
      configDir: join(dir, 'cfg'),
      provider: 'ollama',
      local,
    }
    const id = await startBackground(account, {
      cwd: dir,
      name: 'pm/tern · tidy',
      prompt: 'tidy',
      model: 'local',
      effort: 'high',
    })
    expect(id).toBe('a1b2c3d4')
    const args = (await readFile(log, 'utf8')).split('\n')
    expect(args[args.indexOf('--model') + 1]).toBe('tern:27b')
    expect(args).not.toContain('--effort')
    expect(args).not.toContain('--remote-control')
    const s = JSON.parse(await readFile(settingsPath(join(dir, 'cfg')), 'utf8'))
    expect(s.env.ANTHROPIC_BASE_URL).toBe('http://localhost:11434')
  })
})
