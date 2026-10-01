// A small text editor for drafts: a cursor, a selection, and movement that follows the wrapped
// lines you actually see. Pure functions over { text, cursor, anchor }, so it is easy to test.

export type EditorState = {
  text: string
  cursor: number
  // Where a selection started. null means no selection; the selection runs anchor..cursor.
  anchor: number | null
}

export const editorAt = (text: string): EditorState => ({ text, cursor: text.length, anchor: null })

export function selection(s: EditorState): [number, number] | null {
  if (s.anchor === null || s.anchor === s.cursor) return null
  return s.anchor < s.cursor ? [s.anchor, s.cursor] : [s.cursor, s.anchor]
}

export function selectedText(s: EditorState): string {
  const sel = selection(s)
  return sel ? s.text.slice(sel[0], sel[1]) : ''
}

// Typing replaces the selection, if there is one.
export function insert(s: EditorState, str: string): EditorState {
  const [a, b] = selection(s) ?? [s.cursor, s.cursor]
  return { text: s.text.slice(0, a) + str + s.text.slice(b), cursor: a + str.length, anchor: null }
}

function removeRange(s: EditorState, a: number, b: number): EditorState {
  return { text: s.text.slice(0, a) + s.text.slice(b), cursor: a, anchor: null }
}

export function backspace(s: EditorState, word = false): EditorState {
  const sel = selection(s)
  if (sel) return removeRange(s, sel[0], sel[1])
  if (s.cursor === 0) return s
  return removeRange(s, word ? wordLeft(s.text, s.cursor) : s.cursor - 1, s.cursor)
}

export function forwardDelete(s: EditorState): EditorState {
  const sel = selection(s)
  if (sel) return removeRange(s, sel[0], sel[1])
  if (s.cursor >= s.text.length) return s
  return removeRange(s, s.cursor, s.cursor + 1)
}

const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch)

export function wordLeft(text: string, at: number): number {
  let i = at
  while (i > 0 && !isWord(text[i - 1])) i--
  while (i > 0 && isWord(text[i - 1])) i--
  return i
}

export function wordRight(text: string, at: number): number {
  let i = at
  while (i < text.length && !isWord(text[i])) i++
  while (i < text.length && isWord(text[i])) i++
  return i
}

// A visual line: text[start..end) is shown on it; the newline or wrap point follows.
export type VisualLine = { start: number; end: number }

// The width to lay a draft out at, in a box this wide: inside the border and padding, less the
// one column a line can run past it (see layout). Text that reached it wrapped again on screen.
export const textWidth = (boxWidth: number) => boxWidth - 5

// Wraps at spaces where it can, hard-wraps words wider than the line, keeps blank lines. A line
// can run one column past width: with the space it wraps at, or with the cursor after its end.
export function layout(text: string, width: number): VisualLine[] {
  const w = Math.max(4, width)
  const lines: VisualLine[] = []
  let start = 0
  for (const para of text.split('\n')) {
    let s = 0
    if (para.length === 0) lines.push({ start, end: start })
    while (s < para.length) {
      if (para.length - s <= w) {
        lines.push({ start: start + s, end: start + para.length })
        break
      }
      let cut = para.lastIndexOf(' ', s + w)
      cut = cut > s ? cut + 1 : s + w // keep the space on the line it ends
      lines.push({ start: start + s, end: start + cut })
      s = cut
    }
    start += para.length + 1
  }
  return lines
}

// Which visual line and column the cursor is on. At a wrap point the cursor belongs to the
// start of the next line, except at the very end of a line that ends with a newline.
export function locate(lines: VisualLine[], at: number): { line: number; col: number } {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    const next = lines[i + 1]
    const endsHere = !next || next.start > l.end // a real line break, not a wrap
    if (at >= l.start && (at < l.end || (at === l.end && endsHere)))
      return { line: i, col: at - l.start }
  }
  const last = lines.length - 1
  return { line: Math.max(0, last), col: at - (lines[last]?.start ?? 0) }
}

export type Move =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'home'
  | 'end'
  | 'wordLeft'
  | 'wordRight'
  | 'top'
  | 'bottom'

export function move(s: EditorState, how: Move, width: number, select: boolean): EditorState {
  const sel = selection(s)
  // Without shift, left and right collapse a selection to its edge, like any text box.
  if (!select && sel && (how === 'left' || how === 'right')) {
    return { ...s, cursor: how === 'left' ? sel[0] : sel[1], anchor: null }
  }
  const lines = layout(s.text, width)
  const { line, col } = locate(lines, s.cursor)
  const lineAt = (i: number) => lines[Math.max(0, Math.min(lines.length - 1, i))]!
  let to = s.cursor
  if (how === 'left') to = Math.max(0, s.cursor - 1)
  else if (how === 'right') to = Math.min(s.text.length, s.cursor + 1)
  else if (how === 'wordLeft') to = wordLeft(s.text, s.cursor)
  else if (how === 'wordRight') to = wordRight(s.text, s.cursor)
  else if (how === 'home') to = lineAt(line).start
  else if (how === 'end') to = lineAt(line).end
  else if (how === 'top') to = 0
  else if (how === 'bottom') to = s.text.length
  else {
    const target = how === 'up' ? line - 1 : line + 1
    if (target < 0) to = 0
    else if (target >= lines.length) to = s.text.length
    else {
      const l = lineAt(target)
      to = Math.min(l.start + col, l.end)
    }
  }
  return { text: s.text, cursor: to, anchor: select ? (s.anchor ?? s.cursor) : null }
}
