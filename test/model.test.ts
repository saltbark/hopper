import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Session } from '../src/claude.ts'
import { addAccount, type Config, OVERNIGHT_DEFAULTS } from '../src/config.ts'
import { setHeld } from '../src/held.ts'
import {
  classify,
  gather,
  inScope,
  OTHER,
  projectForCwd,
  toItems,
  waitsOnMe,
} from '../src/model.ts'
import { transcriptPath } from '../src/transcript.ts'
import { fakeClaude } from './helpers.ts'

const s = (over: Partial<Session>): Session => ({
  account: 'bh',
  id: 'a1',
  sessionId: 'x-' + Math.random(),
  kind: 'background',
  cwd: '/w',
  name: 'n',
  startedAt: 1,
  state: 'working',
  ...over,
})
const projects = [
  {
    key: 'meta/inbox',
    path: '/h/projects/meta/inbox',
    runIn: '/h/projects/meta/inbox',
    openFile: '',
  },
  { key: 'pm/lantern', path: '/w/lantern', runIn: '/w/lantern', openFile: '' },
  {
    key: 'pm/lantern/apps/ledger',
    path: '/w/lantern/apps/ledger',
    runIn: '/w/lantern/apps/ledger',
    openFile: '',
  },
]

describe('classify', () => {
  it('puts running work in the queue and waiting work in needs you', () => {
    expect(classify(s({ state: 'working' }))).toBe('queue')
    expect(classify(s({ state: 'blocked' }))).toBe('needs')
    // Claude's "done" means it answered and is waiting: that needs me until I mark it done.
    expect(classify(s({ state: 'done' }))).toBe('needs')
    expect(classify(s({ state: 'failed' }))).toBe('needs')
    expect(classify(s({ sessionId: 'mine', state: 'done' }), new Set(['mine']))).toBe('done')
    expect(classify(s({ kind: 'interactive', id: null, state: 'busy' }))).toBe('live')
  })
  it('keeps an unknown state in the queue rather than losing it', () => {
    expect(classify(s({ state: 'starting' }))).toBe('queue')
  })
})

describe('projectForCwd', () => {
  it('picks the deepest project containing the cwd, and not a sibling with a shared prefix', () => {
    expect(projectForCwd(projects, '/w/lantern/apps/ledger/src')?.key).toBe(
      'pm/lantern/apps/ledger',
    )
    expect(projectForCwd(projects, '/w/lantern')?.key).toBe('pm/lantern')
    expect(projectForCwd(projects, '/w/gtx')).toBeUndefined()
  })
})

describe('toItems', () => {
  it('files sessions outside every project under OTHER, newest first', () => {
    const items = toItems(
      [s({ cwd: '/elsewhere', startedAt: 1 }), s({ cwd: '/w/lantern', startedAt: 5 })],
      projects,
    )
    expect(items.map((i) => i.key)).toEqual(['pm/lantern', OTHER])
  })
})

describe('inScope', () => {
  it('matches the scope and everything below it', () => {
    expect(inScope('bh/news/bulletin', 'bh')).toBe(true)
    expect(inScope('bh/news/bulletin', 'bh/news')).toBe(true)
    expect(inScope('bh/newsx', 'bh/news')).toBe(false)
    expect(inScope('anything', null)).toBe(true)
  })
})

describe('isStale', () => {
  it('flags a usage window whose reset time has passed', async () => {
    const { isStale } = await import('../src/format.ts')
    const now = Date.parse('2026-09-27T12:00:00Z')
    expect(isStale('2026-09-24T03:00:00+00:00', now)).toBe(true)
    expect(isStale('2026-09-30T03:00:00+00:00', now)).toBe(false)
    expect(isStale(null, now)).toBe(false)
  })
})

describe('resetShort', () => {
  it('says when a window resets, or that it already has', async () => {
    const { resetShort } = await import('../src/format.ts')
    const now = Date.parse('2026-09-27T12:00:00Z')
    expect(resetShort('2026-09-27T12:40:00Z', now)).toBe('in 40m')
    expect(resetShort('2026-09-27T15:10:00Z', now)).toBe('in 3h 10m')
    expect(resetShort('2026-09-30T03:00:00Z', now)).toMatch(/^\w{3} \d\d:\d\d$/)
    expect(resetShort('2026-09-24T03:00:00Z', now)).toBe('reset')
  })
})

describe('gather', () => {
  it('keeps the last list of sessions when claude fails to give one', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-model-'))
    const listed = [
      { id: 'aaaa1111', sessionId: 's-1', cwd: home, kind: 'background', state: 'working' },
    ]
    const answer = join(home, 'answer.json')
    await writeFile(answer, JSON.stringify(listed))
    // Answers with whatever answer.json holds, and fails once it's gone.
    const bin = await fakeClaude(
      `case "$1" in auth) echo '{"loggedIn":true}';; agents) cat '${answer}' 2>/dev/null || { echo 'timed out' >&2; exit 1; };; esac`,
    )
    process.env['HOPPER_CLAUDE'] = bin
    try {
      let config: Config = {
        path: join(home, 'c.toml'),
        accountsPath: '',
        home,
        accounts: [],
        routes: [],
        overnight: OVERNIGHT_DEFAULTS,
      }
      config = addAccount(config, { name: 'bh', label: 'bh', configDir: null })
      const first = await gather(config, null, true)
      expect(first.items.map((i) => i.id)).toEqual(['aaaa1111'])
      const at = first.accounts[0]!.sessionsAt
      expect(at).not.toBeNull()

      await rm(answer)
      const failed = await gather(config, first, false)
      expect(failed.items.map((i) => i.id)).toEqual(['aaaa1111'])
      expect(failed.accounts[0]).toMatchObject({ sessionError: 'timed out', sessionsAt: at })
    } finally {
      delete process.env['HOPPER_CLAUDE']
    }
  })

  it('holds a waiting conversation until Claude answers it again', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-model-'))
    const login = join(home, 'login')
    const listed = [
      { id: 'aaaa1111', sessionId: 's-held', cwd: home, kind: 'background', state: 'done' },
      { id: 'bbbb2222', sessionId: 's-new', cwd: home, kind: 'background', state: 'done' },
    ]
    const answer = join(home, 'answer.json')
    await writeFile(answer, JSON.stringify(listed))
    const bin = await fakeClaude(
      `case "$1" in auth) echo '{"loggedIn":true}';; agents) cat '${answer}';; esac`,
    )
    const transcript = transcriptPath(login, home, 's-held')
    await mkdir(dirname(transcript), { recursive: true })
    const reply = (timestamp: string) =>
      JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5' }, timestamp }) + '\n'
    await writeFile(transcript, reply('2026-09-30T10:00:00Z'))
    process.env['HOPPER_CLAUDE'] = bin
    try {
      let config: Config = {
        path: join(home, 'c.toml'),
        accountsPath: '',
        home,
        accounts: [],
        routes: [],
        overnight: OVERNIGHT_DEFAULTS,
      }
      config = addAccount(config, { name: 'bh', label: 'bh', configDir: login })
      await setHeld(home, 's-held', true, Date.parse('2026-09-30T11:00:00Z'))
      const held = await gather(config, null, true)
      const byId = (snap: typeof held, id: string) => snap.items.find((i) => i.sessionId === id)!
      expect(byId(held, 's-held')).toMatchObject({ where: 'needs', held: true })
      expect(byId(held, 's-new').held).toBeUndefined()
      expect(held.items.filter(waitsOnMe).map((i) => i.sessionId)).toEqual(['s-new'])
      expect(held.accounts[0]!.counts.needs).toBe(1)

      // A reply after the hold: it waits on me again, as new.
      await appendFile(transcript, reply('2026-09-30T12:00:00Z'))
      const answered = await gather(config, held, false)
      expect(byId(answered, 's-held').held).toBeUndefined()
      expect(answered.accounts[0]!.counts.needs).toBe(2)
    } finally {
      delete process.env['HOPPER_CLAUDE']
    }
  })
})
