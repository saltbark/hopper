import { describe, expect, it } from 'vitest'

import type { Session } from '../src/claude.ts'
import { classify, inScope, OTHER, projectForCwd, toItems } from '../src/model.ts'

const s = (over: Partial<Session>): Session => ({
  account: 'kf',
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
  { key: 'sb/generaltext', path: '/w/gt', runIn: '/w/gt', openFile: '' },
  {
    key: 'sb/generaltext/apps/crum',
    path: '/w/gt/apps/crum',
    runIn: '/w/gt/apps/crum',
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
    expect(projectForCwd(projects, '/w/gt/apps/crum/src')?.key).toBe('sb/generaltext/apps/crum')
    expect(projectForCwd(projects, '/w/gt')?.key).toBe('sb/generaltext')
    expect(projectForCwd(projects, '/w/gtx')).toBeUndefined()
  })
})

describe('toItems', () => {
  it('files sessions outside every project under OTHER, newest first', () => {
    const items = toItems(
      [s({ cwd: '/elsewhere', startedAt: 1 }), s({ cwd: '/w/gt', startedAt: 5 })],
      projects,
    )
    expect(items.map((i) => i.key)).toEqual(['sb/generaltext', OTHER])
  })
})

describe('inScope', () => {
  it('matches the scope and everything below it', () => {
    expect(inScope('kf/aas/bulletin', 'kf')).toBe(true)
    expect(inScope('kf/aas/bulletin', 'kf/aas')).toBe(true)
    expect(inScope('kf/aasx', 'kf/aas')).toBe(false)
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
