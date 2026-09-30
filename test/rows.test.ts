import { describe, expect, it } from 'vitest'

import type { Item } from '../src/model.ts'
import { shortName } from '../src/tui/panels/ItemRows.tsx'

const item = (name: string, key = 'pm/tern') => ({ name, key, cwd: '/p' }) as Item

describe('shortName', () => {
  it('leaves off the project when the name starts with it, since it has its own column', () => {
    expect(shortName(item('pm/tern · Titles are cut off'))).toBe('Titles are cut off')
  })
  it('keeps names that start with another project, or are only the project', () => {
    expect(shortName(item('pm/meta · Titles are cut off'))).toBe('pm/meta · Titles are cut off')
    expect(shortName(item('pm/tern · '))).toBe('pm/tern · ')
    expect(shortName(item('Draft the spring newsletter'))).toBe('Draft the spring newsletter')
  })
})
