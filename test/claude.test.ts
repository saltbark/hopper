import { homedir } from 'node:os'

import { describe, expect, it } from 'vitest'

import {
  claudeJsonPath,
  envFor,
  parseAuth,
  parseBackgroundId,
  parseSessions,
  parseUsage,
} from '../src/claude.ts'

const dflt = { name: 'bh', label: 'BH', configDir: null }
const other = { name: 'pm', label: 'Pinemoor', configDir: '/tmp/claude-pm' }

describe('envFor', () => {
  it('unsets CLAUDE_CONFIG_DIR for the default login, even if Hopper inherited one', () => {
    process.env['CLAUDE_CONFIG_DIR'] = '/somewhere'
    expect(envFor(dflt)['CLAUDE_CONFIG_DIR']).toBeUndefined()
    delete process.env['CLAUDE_CONFIG_DIR']
  })
  it('sets it for any other login', () => {
    expect(envFor(other)['CLAUDE_CONFIG_DIR']).toBe('/tmp/claude-pm')
  })
})

describe('claudeJsonPath', () => {
  it('is ~/.claude.json for the default login and inside the dir otherwise', () => {
    expect(claudeJsonPath(dflt)).toBe(`${homedir()}/.claude.json`)
    expect(claudeJsonPath(other)).toBe('/tmp/claude-pm/.claude.json')
  })
})

describe('parseSessions', () => {
  // Both shapes, as `claude agents --json --all` printed them on 2.1.283.
  const raw = [
    {
      id: '8074a3dd',
      cwd: '/w/ln-meta',
      kind: 'background',
      startedAt: 10,
      sessionId: '8074a3dd-9f47',
      name: 'Audit the launch copy',
      state: 'blocked',
    },
    {
      pid: 57526,
      cwd: '/w/bh-meta',
      kind: 'interactive',
      startedAt: 20,
      sessionId: '9b4a9a1d-d52e',
      name: 'proj-bh-meta-f1',
      status: 'idle',
    },
    { cwd: '/w/no-session-id' },
  ]
  it('reads background and interactive sessions and skips malformed ones', () => {
    const s = parseSessions(raw, 'bh')
    expect(s).toHaveLength(2)
    expect(s[0]).toMatchObject({
      account: 'bh',
      id: '8074a3dd',
      kind: 'background',
      state: 'blocked',
    })
    expect(s[1]).toMatchObject({ id: null, kind: 'interactive', state: 'idle' })
  })
  it('returns nothing for a non-array', () => {
    expect(parseSessions({}, 'bh')).toEqual([])
  })
})

describe('parseAuth', () => {
  it('keeps the useful fields', () => {
    const a = parseAuth({
      loggedIn: true,
      email: 'a@b.org',
      orgName: 'BH',
      subscriptionType: 'team',
      configDirectory: '/x',
    })
    expect(a).toEqual({
      loggedIn: true,
      email: 'a@b.org',
      orgName: 'BH',
      subscriptionType: 'team',
      configDirectory: '/x',
    })
  })
  it('treats anything else as signed out', () => {
    expect(parseAuth({ loggedIn: false, authMethod: 'none' })).toEqual({ loggedIn: false })
  })
})

describe('parseUsage', () => {
  it('reads the cached windows and when they were fetched', () => {
    const u = parseUsage({
      cachedUsageUtilization: {
        fetchedAtMs: 1790106516910,
        utilization: {
          five_hour: { utilization: 66, resets_at: '2026-09-22T20:50:00+00:00' },
          seven_day: { utilization: 60, resets_at: '2026-09-24T03:00:00+00:00' },
          seven_day_opus: null,
        },
      },
    })
    expect(u).toEqual({
      fetchedAt: 1790106516910,
      fiveHour: { pct: 66, resetsAt: '2026-09-22T20:50:00+00:00' },
      sevenDay: { pct: 60, resetsAt: '2026-09-24T03:00:00+00:00' },
    })
  })
  it('is null when nothing is cached', () => {
    expect(parseUsage({})).toBeNull()
    expect(parseUsage(null)).toBeNull()
  })
})

describe('logins that are not set up', () => {
  it('are signed out with no sessions, without running claude or creating the directory', async () => {
    const { fetchAuth, fetchSessions } = await import('../src/claude.ts')
    const { existsSync } = await import('node:fs')
    const ghost = { name: 'zz', label: 'Nobody', configDir: '/tmp/hopper-no-such-login-dir' }
    process.env['HOPPER_CLAUDE'] = '/bin/false'
    expect(await fetchAuth(ghost)).toEqual({ loggedIn: false })
    expect(await fetchSessions(ghost)).toEqual([])
    expect(existsSync(ghost.configDir)).toBe(false)
    delete process.env['HOPPER_CLAUDE']
  })
})

describe('parseBackgroundId', () => {
  it('reads the id claude --bg prints', () => {
    const out =
      'Starting background service…\nbackgrounded · 699f6c71 · hopper probe\n  claude agents  list sessions\n'
    expect(parseBackgroundId(out)).toBe('699f6c71')
    expect(parseBackgroundId('Workspace not trusted.')).toBeNull()
    // With colour forced, the id comes wrapped in escape codes.
    expect(parseBackgroundId('backgrounded · \x1b[36m0ee6c2bd\x1b[39m · ☾ probe')).toBe('0ee6c2bd')
  })
})
