import xterm from '@xterm/headless'
import type { Key } from 'ink'
import { spawn, type IPty } from 'node-pty'

import { envFor } from '../claude.ts'
import type { Account } from '../config.ts'
import { ANSI, T } from './theme.ts'

// A Claude Code conversation shown inside Hopper. `claude attach` runs in a pseudo-terminal, its
// output feeds a headless terminal emulator, and the emulator's screen is drawn into a panel.
// It's the real conversation, not a copy: every key goes to Claude while the panel has focus.

export type Seg = {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
}

// Claude's own "leave" gesture (← at the empty prompt) swaps the conversation for its list of
// agents. Seeing that screen means the person wants out: Hopper presses enter to put attach back
// on the conversation and hands the keyboard back, leaving the conversation live, as esc used to.
const AGENTS_SCREEN = /enter to return · space to reply/

// The 16 basic colours are Hopper's own (`ANSI`), then the 6×6×6 cube and the grey ramp.
export function paletteHex(n: number): string {
  if (n < 16) return ANSI[n] ?? T.hi
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return '#' + v.toString(16).padStart(2, '0').repeat(3)
  }
  const i = n - 16
  const level = (x: number) => (x === 0 ? 0 : 55 + x * 40).toString(16).padStart(2, '0')
  return '#' + level(Math.floor(i / 36)) + level(Math.floor(i / 6) % 6) + level(i % 6)
}
const rgbHex = (v: number) => '#' + v.toString(16).padStart(6, '0')

// Ink hands keys over already parsed; this turns them back into what a terminal would send.
// shift+enter and option+enter go as ESC CR, which Claude reads as a new line, not a send.
export function keyToBytes(input: string, key: Key): string {
  if (key.return) return key.shift || key.meta ? '\x1b\r' : '\r'
  if (key.escape) return '\x1b'
  if (key.tab) return key.shift ? '\x1b[Z' : '\t'
  if (key.backspace || key.delete) return '\x7f'
  if (key.upArrow) return '\x1b[A'
  if (key.downArrow) return '\x1b[B'
  if (key.rightArrow) return key.meta ? '\x1bf' : '\x1b[C'
  if (key.leftArrow) return key.meta ? '\x1bb' : '\x1b[D'
  if (key.pageUp) return '\x1b[5~'
  if (key.pageDown) return '\x1b[6~'
  if (key.home) return '\x1b[H'
  if (key.end) return '\x1b[F'
  if (key.ctrl && input.length === 1) {
    const c = input.toLowerCase().charCodeAt(0)
    if (c >= 97 && c <= 122) return String.fromCharCode(c - 96)
  }
  if (key.meta && input) return '\x1b' + input
  return input
}

// Whether the cursor sits in Claude's input box with nothing typed: a one-line box between two
// borders, only the ❯ before the cursor, nothing after it but the dim placeholder. Then ← is
// Claude's leave, and Hopper can step back at once rather than wait for the agents screen.
// A Claude menu fails this: its ❯ has no border round it, and the cursor sits on it.
export function atEmptyPrompt(b: xterm.IBuffer): boolean {
  const y = b.viewportY + b.cursorY
  const border = (l: xterm.IBufferLine | undefined) =>
    !!l && l.translateToString(true).startsWith('─')
  const row = b.getLine(y)
  if (!row || !border(b.getLine(y - 1)) || !border(b.getLine(y + 1))) return false
  // Claude follows the ❯ with a no-break space once there's text or a placeholder; \s covers it.
  if (!/^\s*❯\s$/.test(row.translateToString(false, 0, b.cursorX))) return false
  const cell = b.getNullCell()
  for (let x = b.cursorX; x < row.length; x++) {
    row.getCell(x, cell)
    if (cell.getChars().trim() && !cell.isDim()) return false
  }
  return true
}

// How many conversations stay open at once. Each is a `claude attach` process, so the one gone
// into longest ago is closed to make room; the conversation itself keeps running.
export const OPEN_AT_ONCE = 10

// The screen is redrawn at most once a frame, and a quiet one waits this long for the rest of
// what Claude is writing.
const FRAME_MS = 33
const BURST_MS = 4

// The open conversations with `s` put first (in place of any open one with its id), and the
// ones that no longer fit, for the caller to close.
export function admit<S extends { id: string }>(
  open: S[],
  s: S,
  cap = OPEN_AT_ONCE,
): { open: S[]; dropped: S[] } {
  const next = [s, ...open.filter((o) => o !== s && o.id !== s.id)]
  const dropped = open.filter((o) => o !== s && o.id === s.id)
  return { open: next.slice(0, cap), dropped: [...dropped, ...next.slice(cap)] }
}

export class EmbeddedSession {
  private term: xterm.Terminal
  private pty: IPty | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  // Whoever draws the screen: only they redraw when Claude writes, not the whole app.
  private listeners = new Set<() => void>()
  // Set once the attach process ends: writing to it after that is an error.
  private exited = false
  // Whether the program shows the terminal's cursor (DECTCEM, `CSI ? 25 h/l`). Claude puts the
  // real cursor where you type, so Hopper has to draw it; the headless terminal doesn't say.
  private cursorShown = true
  // When a key last went to Claude: until it has redrawn, the screen is no guide to the prompt.
  private lastSent = 0
  // Set while the agents screen is up, so it's answered once rather than on every redraw.
  private onAgents = false
  private lastDraw = 0
  private lastPage = 0

  constructor(
    readonly account: Account,
    readonly id: string,
    readonly name: string,
    private cols: number,
    private rows: number,
    private events: {
      onChange?: () => void
      // The attach process ended.
      onLeave: () => void
      // Claude showed its agents screen: the person stepped back, the conversation stays open.
      onStepBack: () => void
      onCopy?: (text: string) => void
    },
  ) {
    this.term = new xterm.Terminal({ cols, rows, allowProposedApi: true, scrollback: 0 })
    // Claude does its own selection and copies with OSC 52 ("c;<base64>"). A headless
    // terminal has no clipboard, so hand the text to Hopper.
    this.term.parser.registerOscHandler(52, (data) => {
      const b64 = data.slice(data.indexOf(';') + 1)
      if (b64 && b64 !== '?') this.events.onCopy?.(Buffer.from(b64, 'base64').toString('utf8'))
      return true
    })
    // Watch the cursor being shown and hidden, then let the terminal handle the rest as usual.
    const cursorMode = (on: boolean) => (params: (number | number[])[]) => {
      if (params.includes(25)) this.cursorShown = on
      return false
    }
    this.term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, cursorMode(true))
    this.term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, cursorMode(false))
  }

  start(cwd?: string): void {
    const env = Object.fromEntries(
      Object.entries(envFor(this.account)).filter(
        (e): e is [string, string] => typeof e[1] === 'string',
      ),
    )
    this.pty = spawn(process.env['HOPPER_CLAUDE'] || 'claude', ['attach', this.id], {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      ...(cwd ? { cwd } : {}),
      env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    })
    this.pty.onData((d) => this.term.write(d, () => this.changed()))
    this.pty.onExit(() => {
      this.exited = true
      if (!this.closed) this.leave()
    })
  }

  // Redraws at most about 30 times a second, however fast Claude writes. After a quiet spell
  // the first change draws almost at once, so what you type shows without waiting out a frame;
  // the few milliseconds gather the rest of a burst, so a half-written screen isn't drawn.
  private changed(): void {
    if (this.closed || this.timer) return
    const wait = Math.max(BURST_MS, this.lastDraw + FRAME_MS - Date.now())
    this.timer = setTimeout(() => this.draw(), wait)
  }

  private draw(): void {
    this.timer = null
    if (this.closed) return
    this.lastDraw = Date.now()
    const agents = AGENTS_SCREEN.test(this.bottomText())
    if (agents && !this.onAgents) {
      this.send('\r')
      this.events.onStepBack()
    }
    this.onAgents = agents
    this.events.onChange?.()
    for (const l of this.listeners) l()
  }

  // The last few lines with anything on them: where Claude puts its footer. A line the terminal
  // wrapped is joined back up, so a narrow panel doesn't split the footer.
  private bottomText(): string {
    const b = this.term.buffer.active
    const lines: string[] = []
    for (let y = 0; y < this.rows; y++) {
      const line = b.getLine(b.viewportY + y)
      const text = line?.translateToString(true) ?? ''
      if (line?.isWrapped && lines.length) lines[lines.length - 1] += text
      else if (text.trim()) lines.push(text)
    }
    return lines.slice(-3).join('\n')
  }

  private leave(): void {
    this.close()
    this.events.onLeave()
  }

  // A wheel tick over the conversation. If Claude has asked for the mouse, it gets the event
  // itself; otherwise it gets PgUp/PgDn, which is what it asks for, at most a few a second.
  wheel(up: boolean, col: number, row: number): void {
    if (this.closed) return
    if (this.term.modes.mouseTrackingMode !== 'none') {
      const c = Math.max(1, Math.min(this.cols, col))
      const r = Math.max(1, Math.min(this.rows, row))
      return this.send(`\x1b[<${up ? 64 : 65};${c};${r}M`)
    }
    const now = Date.now()
    if (now - this.lastPage < 150) return
    this.lastPage = now
    this.send(up ? '\x1b[5~' : '\x1b[6~')
  }

  // Whether the program inside has asked for the mouse itself.
  mouseWanted(): boolean {
    return !this.closed && this.term.modes.mouseTrackingMode !== 'none'
  }

  // Passes a click, drag or movement through, in the panel's own 1-based cells. Movement with no
  // button only goes to a program that asked for all of it.
  forwardMouse(kind: 'press' | 'drag' | 'move' | 'release', col: number, row: number): void {
    if (kind === 'move' && (this.closed || this.term.modes.mouseTrackingMode !== 'any')) return
    const c = Math.max(1, Math.min(this.cols, col))
    const r = Math.max(1, Math.min(this.rows, row))
    const button = kind === 'drag' ? 32 : kind === 'move' ? 35 : 0
    this.send(`\x1b[<${button};${c};${r}${kind === 'release' ? 'm' : 'M'}`)
  }

  // The text between two cells (0-based, either order), a line per row, trailing space trimmed.
  textBetween(a: { col: number; row: number }, b: { col: number; row: number }): string {
    const [s, e] = a.row < b.row || (a.row === b.row && a.col <= b.col) ? [a, b] : [b, a]
    const buf = this.term.buffer.active
    const out: string[] = []
    for (let r = s.row; r <= e.row; r++) {
      const line = buf.getLine(buf.viewportY + r)
      const from = r === s.row ? s.col : 0
      const to = r === e.row ? e.col + 1 : this.cols
      out.push((line?.translateToString(false, from, to) ?? '').replace(/\s+$/, ''))
    }
    return out.join('\n')
  }

  // Calls `fn` (at most about 30 times a second) whenever the screen changes.
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  send(data: string): void {
    if (this.closed || this.exited) return
    this.lastSent = Date.now()
    this.pty?.write(data)
  }

  // Whether ← now would be Claude's leave, judged from the screen without asking Claude.
  atEmptyPrompt(): boolean {
    return (
      !this.closed && Date.now() - this.lastSent > 150 && atEmptyPrompt(this.term.buffer.active)
    )
  }

  resize(cols: number, rows: number): void {
    if (this.closed || (cols === this.cols && rows === this.rows) || cols < 10 || rows < 4) return
    this.cols = cols
    this.rows = rows
    this.term.resize(cols, rows)
    this.pty?.resize(cols, rows)
  }

  // Where the cursor is on the visible screen (0-based), or null while the program hides it.
  cursor(): { col: number; row: number } | null {
    if (this.closed || !this.cursorShown) return null
    const b = this.term.buffer.active
    const row = b.baseY + b.cursorY - b.viewportY
    if (row < 0 || row >= this.rows) return null
    return { col: Math.min(b.cursorX, this.cols - 1), row }
  }

  // The visible screen as rows of styled runs, ready to draw.
  screen(): Seg[][] {
    const b = this.term.buffer.active
    const cell = b.getNullCell()
    const out: Seg[][] = []
    for (let y = 0; y < this.rows; y++) {
      const line = b.getLine(b.viewportY + y)
      const segs: Seg[] = []
      if (line) {
        for (let x = 0; x < this.cols; x++) {
          line.getCell(x, cell)
          if (cell.getWidth() === 0) continue // the right half of a wide character
          const style: Seg = { text: cell.getChars() || ' ' }
          if (cell.isFgRGB()) style.fg = rgbHex(cell.getFgColor())
          else if (cell.isFgPalette()) style.fg = paletteHex(cell.getFgColor())
          // Text Claude leaves uncoloured would take the terminal's own foreground, green in some themes.
          else style.fg = T.text
          if (cell.isBgRGB()) style.bg = rgbHex(cell.getBgColor())
          else if (cell.isBgPalette()) style.bg = paletteHex(cell.getBgColor())
          if (cell.isBold()) style.bold = true
          if (cell.isDim()) style.dim = true
          if (cell.isItalic()) style.italic = true
          if (cell.isUnderline()) style.underline = true
          if (cell.isInverse()) style.inverse = true
          const last = segs.at(-1)
          const same =
            last &&
            last.fg === style.fg &&
            last.bg === style.bg &&
            last.bold === style.bold &&
            last.dim === style.dim &&
            last.italic === style.italic &&
            last.underline === style.underline &&
            last.inverse === style.inverse
          if (same) last.text += style.text
          else segs.push(style)
        }
      }
      out.push(segs)
    }
    return out
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    // Killing the attach client leaves the session itself running in the background.
    try {
      this.pty?.kill()
    } catch {
      // already gone
    }
    this.term.dispose()
  }
}
