import { describe, expect, it } from 'vitest'

import type { Item } from '../src/model.ts'
import { shortName } from '../src/tui/panels/ItemRows.tsx'

const item = (name: string, key = 'sb/hopper') => ({ name, key, cwd: '/p' }) as Item

describe('shortName', () => {
  it('leaves off the project when the name starts with it, since it has its own column', () => {
    expect(shortName(item('sb/hopper · Titles are cut off'))).toBe('Titles are cut off')
  })
  it('keeps names that start with another project, or are only the project', () => {
    expect(shortName(item('sb/meta · Titles are cut off'))).toBe('sb/meta · Titles are cut off')
    expect(shortName(item('sb/hopper · '))).toBe('sb/hopper · ')
    expect(shortName(item('Set up NCBI search demo'))).toBe('Set up NCBI search demo')
  })
})
