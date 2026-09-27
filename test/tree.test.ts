import { describe, expect, it } from 'vitest'

import { buildTree } from '../src/tree.ts'

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
