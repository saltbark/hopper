// A captured frame (ANSI text) to rows of styled runs, for the page to draw on a canvas cell by
// cell, as a terminal does. Handles what Ink writes for Hopper: truecolor and 256-colour
// foregrounds and backgrounds, bold, inverse. Other escapes (cursor, mouse modes, OSC 8 links)
// are dropped.
/* oxlint-disable no-control-regex -- escape sequences are what this file reads */

type Style = { fg?: string; bg?: string; bold?: boolean; inverse?: boolean }

// One run of text in one style: [text, foreground or null, background or null, bold 0/1].
export type Run = [string, string | null, string | null, 0 | 1]

const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')

const BASE = [
  '#000000',
  '#cd0000',
  '#00cd00',
  '#cdcd00',
  '#0000ee',
  '#cd00cd',
  '#00cdcd',
  '#e5e5e5',
]
const BRIGHT = [
  '#7f7f7f',
  '#ff0000',
  '#00ff00',
  '#ffff00',
  '#5c5cff',
  '#ff00ff',
  '#00ffff',
  '#ffffff',
]

function color256(n: number): string {
  if (n < 8) return BASE[n]!
  if (n < 16) return BRIGHT[n - 8]!
  if (n < 232) {
    const c = n - 16
    const v = (x: number) => (x ? 55 + x * 40 : 0)
    return hex(v(Math.floor(c / 36)), v(Math.floor(c / 6) % 6), v(c % 6))
  }
  const g = 8 + (n - 232) * 10
  return hex(g, g, g)
}

function apply(style: Style, codes: number[]): Style {
  const s = { ...style }
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]!
    if (c === 0) for (const k of Object.keys(s)) delete s[k as keyof Style]
    else if (c === 1) s.bold = true
    else if (c === 22) s.bold = false
    else if (c === 7) s.inverse = true
    else if (c === 27) s.inverse = false
    else if (c === 39) delete s.fg
    else if (c === 49) delete s.bg
    else if (c === 38 || c === 48) {
      const key = c === 38 ? 'fg' : 'bg'
      if (codes[i + 1] === 2) {
        s[key] = hex(codes[i + 2]!, codes[i + 3]!, codes[i + 4]!)
        i += 4
      } else if (codes[i + 1] === 5) {
        s[key] = color256(codes[i + 2]!)
        i += 2
      }
    } else if (c >= 30 && c <= 37) s.fg = color256(c - 30)
    else if (c >= 90 && c <= 97) s.fg = color256(c - 90 + 8)
    else if (c >= 40 && c <= 47) s.bg = color256(c - 40)
    else if (c >= 100 && c <= 107) s.bg = color256(c - 100 + 8)
  }
  return s
}

// The page's own terminal colours stand in for "default" when inverse swaps them.
const TERM_FG = '#c7cfca'
const TERM_BG = '#0f1416'

export function ansiToRows(text: string): Run[][] {
  const clean = text
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[A-Za-ln-z]/g, '')
    .replace(/\n+$/, '')
  const rows: Run[][] = [[]]
  let style: Style = {}
  const push = (chunk: string) => {
    const lines = chunk.split('\n')
    lines.forEach((line, i) => {
      if (i > 0) rows.push([])
      if (!line) return
      const fg = style.inverse ? (style.bg ?? TERM_BG) : (style.fg ?? null)
      const bg = style.inverse ? (style.fg ?? TERM_FG) : (style.bg ?? null)
      const row = rows[rows.length - 1]!
      const last = row[row.length - 1]
      const bold = style.bold ? 1 : 0
      if (last && last[1] === fg && last[2] === bg && last[3] === bold) last[0] += line
      else row.push([line, fg, bg, bold])
    })
  }
  const re = /\u001b\[([0-9;]*)m/g
  let at = 0
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    push(clean.slice(at, m.index))
    style = apply(style, m[1] ? m[1].split(';').map(Number) : [0])
    at = re.lastIndex
  }
  push(clean.slice(at))
  return rows
}
