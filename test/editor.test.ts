import { describe, expect, it } from 'vitest'

import {
  backspace,
  editorAt,
  forwardDelete,
  insert,
  layout,
  locate,
  move,
  offsetAt,
  selectedText,
  view,
  type EditorState,
} from '../src/tui/editor.ts'

const at = (text: string, cursor: number, anchor: number | null = null): EditorState => ({
  text,
  cursor,
  anchor,
})

describe('editing', () => {
  it('inserts at the cursor and replaces a selection', () => {
    expect(insert(at('helo', 3), 'l')).toEqual(at('hello', 4))
    expect(insert(at('hello world', 11, 6), 'there')).toEqual(at('hello there', 11))
  })
  it('backspace, word backspace and forward delete', () => {
    expect(backspace(at('hello', 5))).toEqual(at('hell', 4))
    expect(backspace(at('hello big world', 15), true)).toEqual(at('hello big ', 10))
    expect(backspace(at('hello', 0))).toEqual(at('hello', 0))
    expect(backspace(at('hello world', 5, 0))).toEqual(at(' world', 0))
    expect(forwardDelete(at('hello', 0))).toEqual(at('ello', 0))
  })
})

describe('layout', () => {
  it('wraps at spaces, keeps blank lines, hard-wraps long words', () => {
    const text = 'one two three\n\nabcdefghij'
    expect(layout(text, 8).map((l) => text.slice(l.start, l.end))).toEqual([
      'one two ',
      'three',
      '',
      'abcdefgh',
      'ij',
    ])
  })
  it('runs one column past the width only with the space it wraps at', () => {
    const text = 'aaaa bbbb cc'
    expect(layout(text, 4).map((l) => text.slice(l.start, l.end))).toEqual(['aaaa ', 'bbbb ', 'cc'])
    const words = 'the quick brown fox jumps over the lazy dog  twice over'
    for (let w = 4; w < 20; w++)
      for (const l of layout(words, w)) {
        const shown = words.slice(l.start, l.end)
        expect(shown.replace(/ $/, '').length).toBeLessThanOrEqual(w)
      }
  })
  it('puts the cursor at a wrap point on the next line', () => {
    const lines = layout('one two three', 8)
    expect(locate(lines, 8)).toEqual({ line: 1, col: 0 })
    expect(locate(lines, 13)).toEqual({ line: 1, col: 5 })
  })
})

describe('moving', () => {
  const text = 'one two three\nfour'
  it('left and right, and by word', () => {
    expect(move(at(text, 3), 'left', 80, false).cursor).toBe(2)
    expect(move(at(text, 0), 'wordRight', 80, false).cursor).toBe(3)
    expect(move(at(text, 13), 'wordLeft', 80, false).cursor).toBe(8)
  })
  it('up and down follow wrapped lines, keeping the column', () => {
    // at width 8: "one two " / "three" / "four"
    expect(move(at(text, 2), 'down', 8, false).cursor).toBe(10) // "th|ree"
    expect(move(at(text, 10), 'down', 8, false).cursor).toBe(16) // "fo|ur"
    expect(move(at(text, 16), 'up', 8, false).cursor).toBe(10)
    expect(move(at(text, 2), 'up', 8, false).cursor).toBe(0)
  })
  it('home and end of the visual line', () => {
    expect(move(at(text, 10), 'home', 8, false).cursor).toBe(8)
    expect(move(at(text, 10), 'end', 8, false).cursor).toBe(13)
  })
  it('shift selects; without shift, left/right collapse the selection', () => {
    const s = move(move(editorAt('hello world'), 'wordLeft', 80, true), 'left', 80, true)
    expect(selectedText(s)).toBe(' world')
    expect(move(s, 'right', 80, false)).toEqual(at('hello world', 11))
    expect(move(s, 'left', 80, false)).toEqual(at('hello world', 5))
  })
})

describe('the mouse', () => {
  const text = 'one two three\nfour'
  it('a click puts the cursor where it lands, on the lines as laid out', () => {
    // at width 8: "one two " / "three" / "four"
    const lines = layout(text, 8)
    expect(offsetAt(lines, 1, 2)).toBe(10) // "th|ree"
    expect(offsetAt(lines, 2, 0)).toBe(14)
    // Past the end of a line that ends is its end; one that wraps, before the space it wraps at.
    expect(offsetAt(lines, 2, 30)).toBe(18)
    expect(offsetAt(lines, 0, 30)).toBe(7)
    // Below the last line is the end of the text.
    expect(offsetAt(lines, 9, 0)).toBe(18)
  })
  it('the view follows the cursor once it passes the bottom', () => {
    expect(view({ text, cursor: 0 }, 8, 2).start).toBe(0)
    expect(view({ text, cursor: text.length }, 8, 2).start).toBe(1)
  })
})
