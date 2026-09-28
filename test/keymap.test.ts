import { describe, expect, it } from 'vitest'

import type { Item } from '../src/model.ts'
import { barKeys, hereKeys, type Here } from '../src/tui/keymap.ts'

const base: Here = {
  focus: 'work',
  scope: null,
  embedOpen: false,
  summaryShown: true,
  untrusted: false,
  editing: null,
}
const conversation = { id: 'abc', kind: 'background' } as Item
const keysOf = (h: Partial<Here>) => hereKeys({ ...base, ...h }).hints.map(([k]) => k)

describe('hereKeys', () => {
  it('follows what is selected in the list', () => {
    expect(keysOf({ item: conversation })).toEqual(['⏎ →', 'm', 'J K', 'w d r o u'])
    expect(keysOf({ item: conversation, embedOpen: true })).toEqual([
      '⏎ →',
      'i',
      'm',
      'J K',
      'w d r o u',
    ])
    expect(keysOf({ focus: 'done', item: conversation })).toEqual(['⏎ →', 'm'])
  })
  it('offers fold only on folders, and esc only when the list is narrowed', () => {
    const row = { key: 'sb', hasChildren: true, folded: true } as Here['row']
    expect(keysOf({ focus: 'projects', row, scope: 'sb' })).toEqual([
      '⏎',
      't',
      'z',
      'J K',
      'opt+↑↓',
      'esc',
    ])
    expect(hereKeys({ ...base, focus: 'projects', row }).hints).toContainEqual(['z', 'unfold'])
  })
  it('knows a conversation and a draft', () => {
    expect(hereKeys({ ...base, focus: 'session' }).label).toBe('a conversation')
    const editing = { stage: 'act', model: 'opus' } as Here['editing']
    expect(hereKeys({ ...base, editing }).hints).toContainEqual(['m', 'model (opus)'])
  })
  it('leaves out of the key bar what the screen already shows', () => {
    // The summary lists ⏎ and m, leaving → of "⏎ →"; the list's headings show the group letters.
    expect(barKeys({ ...base, item: conversation }).map(([k]) => k)).toEqual(['→', 'J K'])
    // With the conversation open instead, nothing on the right lists them.
    expect(
      barKeys({ ...base, item: conversation, embedOpen: true, summaryShown: false }).map(
        ([k]) => k,
      ),
    ).toEqual(['⏎ →', 'i', 'm', 'J K'])
    expect(barKeys({ ...base, focus: 'accounts' })).toEqual([])
  })
})
