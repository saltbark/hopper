import { describe, expect, it } from 'vitest'

import { wrapText } from '../src/format.ts'
import { parseItems } from '../src/items.ts'

describe('parseItems', () => {
  it('reads titled and plain items and skips done ones', () => {
    expect(parseItems('- [ ] **A** — body\n- [x] done\n- [ ] plain\n')).toEqual([
      { title: 'A', body: 'body' },
      { title: 'plain', body: '' },
    ])
  })
})

describe('wrapText', () => {
  it('wraps on words, keeps blank lines, and splits very long words', () => {
    expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four'])
    expect(wrapText('a\n\nb', 10)).toEqual(['a', '', 'b'])
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })
})
