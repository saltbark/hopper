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
        p('pm/meta', c(0), 60_000),
        p('bh/meta', c(0, 0, 1)),
        p('pm/ledger', c(4)),
        p('pm/tern', c(11, 2, 2)),
        p('meta/inbox', c(0, 1)),
        p('pm/quill', c(0)),
      ],
      'pm/quill',
      now,
    )
    expect(rows.map((r) => r.key)).toEqual([
      'pm/quill',
      'pm/tern',
      'bh/meta',
      'meta/inbox',
      'pm/meta',
    ])
    expect(rows.every((r) => r.isProject)).toBe(true)
  })
  it('leaves out projects with nothing going on for a day', () => {
    expect(activeRows([p('pm/ledger', c(9)), p('pm/old', c(0), RECENT_MS + 1)], null, now)).toEqual(
      [],
    )
  })
})

describe('rollUp', () => {
  const stats = [
    { key: 'pm/lantern', counts: c(1), last: 5 },
    { key: 'pm/lantern/apps/ledger', counts: c(0, 1), last: 9 },
    { key: 'pm/lantern/apps/sprout', counts: c(2, 0, 1), last: 3 },
    { key: 'pm/lanterns', counts: c(7), last: 20 },
  ]
  it('sums a folder over the projects in it, and only those', () => {
    expect(rollUp('pm/lantern/apps', stats)).toEqual({
      key: 'pm/lantern/apps',
      isProject: false,
      counts: c(2, 1, 1),
      last: 9,
    })
  })
  it('lets a key be a project and a folder at once', () => {
    expect(rollUp('pm/lantern', stats)).toMatchObject({ isProject: true, counts: c(3, 1, 1) })
  })
})
