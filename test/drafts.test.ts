import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { deleteDraft, listDrafts, parseDraft, saveDraft, serializeDraft } from '../src/drafts.ts'

const d = {
  id: 'abc-1',
  project: 'meta/inbox',
  text: 'line one\n\nline three\n',
  created: Date.parse('2026-09-27T10:00:00Z'),
  updated: Date.parse('2026-09-27T10:05:00Z'),
}

describe('drafts', () => {
  it('round-trip, blank lines and all', () => {
    expect(parseDraft('abc-1', serializeDraft(d))).toEqual(d)
    expect(parseDraft('x', 'no front matter')).toBeNull()
  })
  it('list newest first, and delete', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-drafts-'))
    expect(await listDrafts(home)).toEqual([])
    await saveDraft(home, d)
    await saveDraft(home, { ...d, id: 'abc-2', updated: d.updated + 1000 })
    expect((await listDrafts(home)).map((x) => x.id)).toEqual(['abc-2', 'abc-1'])
    await deleteDraft(home, 'abc-2')
    expect((await listDrafts(home)).map((x) => x.id)).toEqual(['abc-1'])
  })
})

describe('drafts carry their model', () => {
  it('round-trips model and effort, and leaves them out when unset', async () => {
    const { parseDraft, serializeDraft } = await import('../src/drafts.ts')
    const withModel = { ...d, model: 'haiku', effort: 'low' }
    expect(parseDraft('abc-1', serializeDraft(withModel))).toEqual(withModel)
    expect(serializeDraft(d)).not.toContain('model:')
  })
})
