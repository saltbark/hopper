import { describe, expect, it } from 'vitest'

import { matches } from '../src/tui/fuzzy.ts'

describe('matches', () => {
  it('finds every word in the name or the project, in any case and any order', () => {
    expect(matches('tide', 'Check the tide tables', 'bh/atlas')).toBe(true)
    expect(matches('TABLES check', 'Check the tide tables', 'bh/atlas')).toBe(true)
    expect(matches('atlas tide', 'Check the tide tables', 'bh/atlas')).toBe(true)
    expect(matches('tide moon', 'Check the tide tables', 'bh/atlas')).toBe(false)
  })
  it('takes a word that spells out the project, but not one scattered through the name', () => {
    expect(matches('atl tide', 'Check the tide tables', 'bh/atlas')).toBe(true)
    expect(matches('bha', 'Check the tide tables', 'bh/atlas')).toBe(true)
    expect(matches('ctt', 'Check the tide tables', 'bh/atlas')).toBe(false)
  })
  it('finds everything with nothing typed', () => {
    expect(matches('  ', 'Check the tide tables', 'bh/atlas')).toBe(true)
  })
})
