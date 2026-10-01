import { stripVTControlCharacters } from 'node:util'

import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { CHOICE_DEFAULTS } from '../src/config.ts'
import { DraftPane } from '../src/tui/panes/DraftPane.tsx'
import { newEditing } from '../src/tui/state.ts'

const draw = (text: string, cursor = text.length, width = 20) =>
  stripVTControlCharacters(
    render(
      <DraftPane
        editing={newEditing({ id: 'd', project: 'bh/atlas', text, created: 0, cursor })}
        defaults={CHOICE_DEFAULTS}
        width={width}
        height={10}
      />,
    ).lastFrame() ?? '',
  )

// The rows inside the border, trimmed, down to the last one with text.
const body = (frame: string) => {
  const rows = frame
    .split('\n')
    .filter((r) => r.startsWith('│'))
    .map((r) => r.slice(1, -1).trim())
  while (rows.at(-1) === '') rows.pop()
  return rows
}

describe('the draft pane', () => {
  // At width 20 the text has 15 columns: 16 inside the border and padding, less one for the space
  // a line wraps at or the cursor after its end.
  it('wraps a line whose word ends at the edge without a blank row after it', () => {
    expect(body(draw('abcdefghij abcde fgh', 0))).toEqual(['abcdefghij', 'abcde fgh'])
    expect(body(draw('abcdefghij abcd efgh ijkl', 0))).toEqual(['abcdefghij abcd', 'efgh ijkl'])
    expect(body(draw('abcdefghij abcd efgh ijkl', 15))).toEqual(['abcdefghij abcd', 'efgh ijkl'])
  })
  it('keeps room for the cursor after a line that fills the box', () => {
    expect(body(draw('abcdefghijklmnop'))).toEqual(['abcdefghijklmno', 'p'])
    expect(body(draw('abcdefghij abcd\nnext', 15))).toEqual(['abcdefghij abcd', 'next'])
  })
})
