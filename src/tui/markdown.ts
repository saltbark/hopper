import { marked, type Token, type Tokens } from 'marked'

import { T } from './theme.ts'

// Markdown laid out for a panel: `marked` reads it, and this turns what it read into lines of
// styled spans already wrapped to the width, one entry per line on screen, so the panel can count
// and scroll them. Terminals have bold, italic, colour and box characters, which is most of what a
// report uses; links show their text and carry the URL as a terminal hyperlink (OSC 8).

export type Span = {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  color?: string
  link?: string
}
export type Line = Span[]

type Style = Omit<Span, 'text'>

// A forced line break inside a paragraph (a markdown `br`).
const BREAK: Span = { text: '\n' }

export function markdownLines(src: string, width: number): Line[] {
  return blocks(marked.lexer(src), Math.max(8, width), true)
}

// A line's text with the styling dropped: what tests and the mouse read.
export const plain = (line: Line) => line.map((s) => s.text).join('')

// Blocks one after another, with a blank line between them when `loose`.
function blocks(tokens: Token[], width: number, loose: boolean): Line[] {
  const out: Line[] = []
  for (const t of tokens) {
    const lines = block(t, width)
    if (!lines.length) continue
    if (out.length && loose) out.push([])
    out.push(...lines)
  }
  return out
}

function block(t: Token, width: number): Line[] {
  switch (t.type) {
    case 'space':
    case 'def':
    case 'checkbox':
      return []
    case 'heading': {
      const h = t as Tokens.Heading
      const color = h.depth === 1 ? T.hi : h.depth === 2 ? T.focus : T.text
      return wrap(inline(h.tokens, { bold: true, color }), width)
    }
    case 'paragraph':
    case 'text': {
      const p = t as Tokens.Paragraph | Tokens.Text
      return wrap(p.tokens ? inline(p.tokens, {}) : [{ text: p.text }], width)
    }
    case 'list':
      return list(t as Tokens.List, width)
    case 'blockquote': {
      const bar: Span = { text: '│ ', color: T.line }
      return blocks((t as Tokens.Blockquote).tokens, width - 2, true).map((l) => [
        bar,
        ...l.map((s) => ({ ...s, color: s.color ?? T.dim, italic: true })),
      ])
    }
    case 'code':
      return (t as Tokens.Code).text
        .split('\n')
        .map((l) => [{ text: '  ' + clip(l.replace(/\t/g, '  '), width - 2), color: T.code }])
    case 'hr':
      return [[{ text: '─'.repeat(width), color: T.line }]]
    case 'table':
      return table(t as Tokens.Table, width)
    case 'html':
      return wrap([{ text: (t as Tokens.HTML).text.trimEnd(), color: T.dim }], width)
    default:
      return 'raw' in t && t.raw.trim() ? wrap([{ text: t.raw.trimEnd() }], width) : []
  }
}

// Each item's own blocks at the width left over from its marker, the marker on its first line
// and the continuation lines hung under the text rather than the marker.
function list(l: Tokens.List, width: number): Line[] {
  const start = typeof l.start === 'number' ? l.start : 1
  const markers = l.items.map((item, i) =>
    item.task
      ? { text: item.checked ? '☑ ' : '☐ ', color: item.checked ? T.dim : T.focus }
      : { text: l.ordered ? `${start + i}. ` : '• ', color: T.dim },
  )
  const room = Math.max(...markers.map((m) => m.text.length))
  const out: Line[] = []
  l.items.forEach((item, i) => {
    if (i && l.loose) out.push([])
    const marker = { ...markers[i]!, text: markers[i]!.text.padStart(room) }
    const body = blocks(item.tokens, width - room, item.loose)
    const done = item.task && item.checked
    body.forEach((line, j) =>
      out.push([
        j ? { text: ' '.repeat(room) } : marker,
        ...(done ? line.map((s) => ({ ...s, color: T.dim })) : line),
      ]),
    )
    if (!body.length) out.push([marker])
  })
  return out
}

// A table in columns when it fits the width; when it doesn't, each row as `header: value` lines,
// which keeps every cell readable at the cost of the grid.
function table(t: Tokens.Table, width: number): Line[] {
  const head = t.header.map((c) => inline(c.tokens, { bold: true, color: T.hi }))
  const rows = t.rows.map((r) => r.map((c) => inline(c.tokens, {})))
  const cols = head.length
  const size = (spans: Span[]) => spans.reduce((n, s) => n + s.text.length, 0)
  const widths = head.map((h, i) => Math.max(size(h), ...rows.map((r) => size(r[i] ?? []))))
  const sep = { text: ' │ ', color: T.line }
  if (widths.reduce((a, b) => a + b, 0) + 3 * (cols - 1) <= width) {
    const row = (cells: Span[][]) =>
      cells.flatMap((cell, i) => {
        const pad = ' '.repeat(widths[i]! - size(cell))
        const right = t.align[i] === 'right'
        const spans = right ? [{ text: pad }, ...cell] : [...cell, { text: pad }]
        return i ? [sep, ...spans] : spans
      })
    const rule = widths.map((w) => '─'.repeat(w)).join('─┼─')
    return [row(head), [{ text: rule, color: T.line }], ...rows.map(row)]
  }
  const out: Line[] = []
  rows.forEach((r, i) => {
    if (i) out.push([])
    r.forEach((cell, j) => {
      const label = head[j]?.length ? [...head[j]!, { text: ': ', color: T.dim }] : []
      out.push(...wrap([...label.map((s) => ({ ...s, color: T.dim })), ...cell], width))
    })
  })
  return out
}

// Inline tokens as spans, each carrying the style of everything it sits inside.
function inline(tokens: Token[] | undefined, style: Style): Span[] {
  const out: Span[] = []
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong':
        out.push(...inline((t as Tokens.Strong).tokens, { ...style, bold: true }))
        break
      case 'em':
        out.push(...inline((t as Tokens.Em).tokens, { ...style, italic: true }))
        break
      case 'del':
        out.push(...inline((t as Tokens.Del).tokens, { ...style, strike: true }))
        break
      case 'codespan':
        out.push({ ...style, text: (t as Tokens.Codespan).text, color: T.code })
        break
      case 'link': {
        const l = t as Tokens.Link
        out.push(...inline(l.tokens, { ...style, color: T.link, link: l.href }))
        break
      }
      case 'image':
        out.push({ ...style, text: `[${(t as Tokens.Image).text || 'image'}]`, color: T.dim })
        break
      case 'br':
        out.push(BREAK)
        break
      case 'text': {
        const x = t as Tokens.Text
        if (x.tokens?.length) out.push(...inline(x.tokens, style))
        else out.push({ ...style, text: x.text })
        break
      }
      default:
        out.push({ ...style, text: 'text' in t ? String(t.text) : t.raw })
    }
  }
  return out
}

// Spans wrapped at spaces to `width`, a word longer than the width cut across lines. A word can
// run across spans (`code`, then a comma) and still only breaks at a space.
export function wrap(spans: Span[], width: number): Line[] {
  const w = Math.max(4, width)
  const lines: Line[] = []
  let line: Line = []
  let used = 0
  // The word being gathered, the space waiting in front of it, and whether a break comes next.
  let word: Span[] = []
  let space: Span | undefined
  const put = (s: Span) => {
    const last = line[line.length - 1]
    if (last && sameStyle(last, s)) line[line.length - 1] = { ...last, text: last.text + s.text }
    else line.push(s)
    used += s.text.length
  }
  const end = () => {
    lines.push(line)
    line = []
    used = 0
  }
  const flush = () => {
    const size = word.reduce((n, s) => n + s.text.length, 0)
    if (!size) return
    if (used && used + (space ? 1 : 0) + size > w) end()
    else if (used && space) put(space)
    for (let s of word) {
      while (s.text.length > w - used) {
        const cut = w - used
        put({ ...s, text: s.text.slice(0, cut) })
        s = { ...s, text: s.text.slice(cut) }
        end()
      }
      if (s.text) put(s)
    }
    word = []
    space = undefined
  }
  for (const s of spans) {
    if (s === BREAK) {
      flush()
      end()
      continue
    }
    for (const [i, part] of s.text.split('\n').entries()) {
      if (i) {
        flush()
        end()
      }
      for (const [j, piece] of part.split(/ +/).entries()) {
        if (j) {
          flush()
          space = { ...s, text: ' ' }
        }
        if (piece) word.push({ ...s, text: piece })
      }
    }
  }
  flush()
  if (line.length || !lines.length) lines.push(line)
  return lines
}

const sameStyle = (a: Span, b: Span) =>
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.strike === b.strike &&
  a.color === b.color &&
  a.link === b.link

const clip = (s: string, w: number) => (s.length > w ? s.slice(0, Math.max(0, w - 1)) + '…' : s)
