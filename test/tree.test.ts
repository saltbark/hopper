import { describe, expect, it } from 'vitest'

import { activeRows, buildTree, RECENT_MS } from '../src/tree.ts'

const c = (open: number, run = 0, you = 0) => ({ open, run, you })
const entries = [
  { key: 'meta/inbox', isProject: true, counts: c(3) },
  { key: 'meta/ideas', isProject: true, counts: c(2, 0, 1) },
  { key: 'sb/generaltext', isProject: true, counts: c(1) },
  { key: 'sb/generaltext/apps/crum', isProject: true, counts: c(0, 1) },
]

describe('buildTree', () => {
  it('makes a node for every prefix, sorted, with counts rolled up', () => {
    const rows = buildTree(entries, new Set())
    expect(rows.map((r) => '  '.repeat(r.depth) + r.name)).toEqual([
      'meta',
      '  ideas',
      '  inbox',
      'sb',
      '  generaltext',
      '    apps',
      '      crum',
    ])
    expect(rows[0]?.counts).toEqual(c(5, 0, 1))
    expect(rows[3]?.counts).toEqual(c(1, 1, 0))
  })
  it('lets a key be a project and a folder at once', () => {
    const gt = buildTree(entries, new Set()).find((r) => r.key === 'sb/generaltext')
    expect(gt).toMatchObject({ isProject: true, hasChildren: true })
  })
  it('hides children of folded nodes but keeps their counts', () => {
    const rows = buildTree(entries, new Set(['sb']))
    expect(rows.map((r) => r.key)).toEqual(['meta', 'meta/ideas', 'meta/inbox', 'sb'])
    expect(rows[3]).toMatchObject({ folded: true, counts: c(1, 1, 0) })
  })
})

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
    expect(rows.map((r) => r.name)).toEqual([
      'sb/pact',
      'sb/hopper',
      'kf/meta',
      'meta/inbox',
      'sb/meta',
    ])
    expect(rows.every((r) => r.active && r.isProject && !r.hasChildren)).toBe(true)
  })
  it('leaves out projects with nothing going on for a day', () => {
    expect(activeRows([p('sb/crum', c(9)), p('sb/old', c(0), RECENT_MS + 1)], null, now)).toEqual(
      [],
    )
  })
})
