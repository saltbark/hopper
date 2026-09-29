import { describe, expect, it } from 'vitest'

import { activeRows, RECENT_MS, rollUp } from '../src/active.ts'

const c = (open: number, run = 0, you = 0) => ({ open, run, you })

describe('activeRows', () => {
  const now = 10 * RECENT_MS
  const p = (key: string, counts: ReturnType<typeof c>, ago = RECENT_MS * 2) => ({
    key,
    counts,
    last: now - ago,
  })
  it('lists the scope, then waiting on you, then running, then recent, by full key', () => {
    const rows = activeRows(
      [
        p('sb/meta', c(0), 60_000),
        p('kf/meta', c(0, 0, 1)),
        p('sb/crum', c(4)),
        p('sb/hopper', c(11, 2, 2)),
        p('meta/inbox', c(0, 1)),
        p('sb/pact', c(0)),
      ],
      'sb/pact',
      now,
    )
    expect(rows.map((r) => r.key)).toEqual([
      'sb/pact',
      'sb/hopper',
      'kf/meta',
      'meta/inbox',
      'sb/meta',
    ])
    expect(rows.every((r) => r.isProject)).toBe(true)
  })
  it('leaves out projects with nothing going on for a day', () => {
    expect(activeRows([p('sb/crum', c(9)), p('sb/old', c(0), RECENT_MS + 1)], null, now)).toEqual(
      [],
    )
  })
})

describe('rollUp', () => {
  const stats = [
    { key: 'sb/generaltext', counts: c(1), last: 5 },
    { key: 'sb/generaltext/apps/crum', counts: c(0, 1), last: 9 },
    { key: 'sb/generaltext/apps/beans', counts: c(2, 0, 1), last: 3 },
    { key: 'sb/generaltextual', counts: c(7), last: 20 },
  ]
  it('sums a folder over the projects in it, and only those', () => {
    expect(rollUp('sb/generaltext/apps', stats)).toEqual({
      key: 'sb/generaltext/apps',
      isProject: false,
      counts: c(2, 1, 1),
      last: 9,
    })
  })
  it('lets a key be a project and a folder at once', () => {
    expect(rollUp('sb/generaltext', stats)).toMatchObject({ isProject: true, counts: c(3, 1, 1) })
  })
})
