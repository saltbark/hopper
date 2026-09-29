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
    expect(keysOf({ item: conversation })).toEqual(['⏎ →', 'd', 'J K'])
    expect(keysOf({ item: conversation, embedOpen: true })).toEqual(['⏎ →', 'i', 'd', 'J K'])
    expect(keysOf({ focus: 'done', item: conversation })).toEqual(['⏎ →', 'd'])
  })
  it('offers tab in Projects only on a project, and esc on the list only when it is narrowed', () => {
    const row = (isProject: boolean) => ({ key: 'sb', isProject }) as Here['row']
    expect(keysOf({ focus: 'projects', row: row(true) })).toEqual(['⏎', 'tab', '↑↓', 'esc'])
    expect(keysOf({ focus: 'projects', row: row(false) })).toEqual(['⏎', '↑↓', 'esc'])
    expect(keysOf({ item: conversation, scope: 'sb' })).toEqual(['⏎ →', 'd', 'J K', 'esc'])
    expect(keysOf({ item: conversation })).not.toContain('esc')
  })
  it("offers a report's conversation only while Claude still has it", () => {
    const list = hereKeys({ ...base, reports: { reading: false, conversation: false } })
    expect(list.label).toBe('routine reports')
    expect(list.hints.map(([k]) => k)).toEqual(['j k ↑↓', '⏎ →', 'esc ←'])
    const reading = hereKeys({ ...base, reports: { reading: true, conversation: true } })
    expect(reading.label).toBe('a report')
    expect(reading.hints).toContainEqual(['c', 'its conversation'])
    // The reports keep the keyboard, so the bar shows their keys and nothing else.
    expect(barKeys({ ...base, reports: { reading: true, conversation: true } })).toEqual(
      reading.hints,
    )
  })
  it('knows a conversation, a draft on the list, and writing one', () => {
    expect(hereKeys({ ...base, focus: 'session' }).label).toBe('a conversation')
    const draft = { kind: 'draft', model: 'opus' } as Item
    const hints = hereKeys({ ...base, item: draft }).hints
    expect(hints).toContainEqual(['m', 'model (opus)'])
    expect(hints).toContainEqual(['s', 'start it'])
    expect(hints).toContainEqual(['d', 'throw away'])
    const editing = { stage: 'write' } as Here['editing']
    expect(hereKeys({ ...base, editing }).hints).toContainEqual(['esc', 'save and close'])
  })
  it('leaves out of the key bar what the screen already shows', () => {
    // The summary lists ⏎ and d, leaving → of "⏎ →".
    expect(barKeys({ ...base, item: conversation }).map(([k]) => k)).toEqual(['→', 'J K'])
    // With the conversation open instead, nothing on the right lists them.
    expect(
      barKeys({ ...base, item: conversation, embedOpen: true, summaryShown: false }).map(
        ([k]) => k,
      ),
    ).toEqual(['⏎ →', 'i', 'd', 'J K'])
    expect(barKeys({ ...base, focus: 'accounts' })).toEqual([])
  })
})
