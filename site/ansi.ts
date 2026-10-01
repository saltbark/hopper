// A captured frame (ANSI text) to HTML: one <span> per run of the same style. Handles what Ink
// writes for Hopper: truecolor and 256-colour foregrounds and backgrounds, bold, dim, italic,
// underline, inverse. Other escapes (cursor, mouse modes, OSC 8 links) are dropped.
/* oxlint-disable no-control-regex -- escape sequences are what this file reads */

type Style = {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')

function color256(n: number): string {
  const base = [
    '#000000',
    '#cd0000',
    '#00cd00',
    '#cdcd00',
    '#0000ee',
    '#cd00cd',
    '#00cdcd',
    '#e5e5e5',
  ]
  const bright = [
    '#7f7f7f',
    '#ff0000',
    '#00ff00',
    '#ffff00',
    '#5c5cff',
    '#ff00ff',
    '#00ffff',
    '#ffffff',
  ]
  if (n < 8) return base[n]!
  if (n < 16) return bright[n - 8]!
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
    else if (c === 2) s.dim = true
    else if (c === 22) s.bold = s.dim = false
    else if (c === 3) s.italic = true
    else if (c === 23) s.italic = false
    else if (c === 4) s.underline = true
    else if (c === 24) s.underline = false
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

function css(s: Style): string {
  const fg = s.inverse ? (s.bg ?? 'var(--term-bg)') : s.fg
  const bg = s.inverse ? (s.fg ?? 'var(--term-fg)') : s.bg
  const out: string[] = []
  if (fg) out.push(`color:${fg}`)
  if (bg) out.push(`background:${bg}`)
  if (s.bold) out.push('font-weight:700')
  if (s.dim) out.push('opacity:.6')
  if (s.italic) out.push('font-style:italic')
  if (s.underline) out.push('text-decoration:underline')
  return out.join(';')
}

// The web font has ASCII, box drawing and blocks; anything else (✓ ◇ ↻ ☾ ⏎, the braille spinner)
// comes from a fallback font whose width differs, which pushes the rest of the row sideways. Each
// such glyph gets a cell exactly one column wide, as a terminal would give it.
const cells = (html: string) =>
  html.replace(/[^\u0000-\u007f─-▟…·]/gu, (g) => `<span class="g">${g}</span>`)

export function ansiToHtml(text: string): string {
  // Drop OSC sequences (links, titles), then any CSI that isn't a colour.
  const clean = text
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[A-Za-ln-z]/g, '')
  let style: Style = {}
  let html = ''
  let open = ''
  const re = /\u001b\[([0-9;]*)m/g
  let last = 0
  const flush = (chunk: string) => {
    if (!chunk) return
    const c = css(style)
    if (c !== open) {
      if (open) html += '</span>'
      if (c) html += `<span style="${c}">`
      open = c
    }
    html += cells(esc(chunk))
  }
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    flush(clean.slice(last, m.index))
    style = apply(style, m[1] ? m[1].split(';').map(Number) : [0])
    last = re.lastIndex
  }
  flush(clean.slice(last))
  if (open) html += '</span>'
  return html.replace(/\n+$/, '')
}
