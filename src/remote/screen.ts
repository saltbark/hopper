import type { Account } from '../config.ts'
import { EmbeddedSession, type Seg } from '../tui/embed.ts'
import { T } from '../tui/theme.ts'

// A conversation open on the phone. The Mac runs its own `claude attach` at the phone's size (the
// same EmbeddedSession the right panel uses) and sends the screen as rows of styled runs; only
// the rows that changed go after the first. The phone draws them and sends keys back. Like the
// panel, it shows Claude's screen and nothing else: the wheel becomes PgUp/PgDn (or mouse events,
// when Claude asked for the mouse), and Claude scrolls itself.
//
// Two attach clients share one width, the last to resize: opening here takes the conversation to
// the phone's width, and Hopper's panel takes it back when it gets the keyboard (`reclaim`).

// A run of text: [text, fg, bg, flags]. fg is left out when it's Hopper's text colour, bg when
// there is none, flags (1 bold, 2 dim, 4 italic, 8 underline, 16 inverse) when zero.
export type Run =
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, number]

export type ScreenFrame = {
  t: 'screen'
  id: string
  cols: number
  rows: number
  // Rows that changed since the last frame, by index; all of them when `full`.
  set: [number, Run[]][]
  full: boolean
  cursor: [number, number] | null
}

export function runs(segs: Seg[]): Run[] {
  return segs.map((s) => {
    const flags =
      (s.bold ? 1 : 0) |
      (s.dim ? 2 : 0) |
      (s.italic ? 4 : 0) |
      (s.underline ? 8 : 0) |
      (s.inverse ? 16 : 0)
    const fg = s.fg && s.fg !== T.text ? s.fg : ''
    const bg = s.bg ?? ''
    if (flags) return [s.text, fg, bg, flags]
    if (bg) return [s.text, fg, bg]
    if (fg) return [s.text, fg]
    return [s.text]
  })
}

// What the bridge needs to open one: the item's attach id, its login and folder.
export type Target = { sessionId: string; attachId: string; account: Account; cwd: string }

export type Spawn = (
  account: Account,
  attachId: string,
  name: string,
  cols: number,
  rows: number,
  events: ConstructorParameters<typeof EmbeddedSession>[5],
) => Pick<
  EmbeddedSession,
  | 'start'
  | 'subscribe'
  | 'screen'
  | 'cursor'
  | 'send'
  | 'paste'
  | 'resize'
  | 'wheel'
  | 'close'
  | 'reclaim'
>

const realSpawn: Spawn = (account, id, name, cols, rows, events) =>
  new EmbeddedSession(account, id, name, cols, rows, events)

export class PhoneScreen {
  private readonly embed: ReturnType<Spawn>
  private sent: string[] = []
  private cols: number
  private rows: number

  constructor(
    readonly target: Target,
    cols: number,
    rows: number,
    private readonly out: (frame: ScreenFrame | { t: 'closed'; id: string }) => void,
    spawn: Spawn = realSpawn,
  ) {
    this.cols = clamp(cols, 20, 200)
    this.rows = clamp(rows, 8, 120)
    this.embed = spawn(target.account, target.attachId, '', this.cols, this.rows, {
      onLeave: () => this.out({ t: 'closed', id: target.sessionId }),
      // Claude's agents screen means ← at an empty prompt; the embed puts the conversation back.
      onStepBack: () => {},
    })
    this.embed.subscribe(() => this.frame(false))
    this.embed.start(target.cwd)
  }

  get id() {
    return this.target.sessionId
  }

  frame(full: boolean) {
    const rows = this.embed.screen().map((r) => JSON.stringify(runs(r)))
    const set: [number, Run[]][] = []
    rows.forEach((r, i) => {
      if (full || r !== this.sent[i]) set.push([i, JSON.parse(r) as Run[]])
    })
    this.sent = rows
    const c = this.embed.cursor()
    this.out({
      t: 'screen',
      id: this.id,
      cols: this.cols,
      rows: this.rows,
      set,
      full,
      cursor: c ? [c.col, c.row] : null,
    })
  }

  keys(data: string) {
    this.embed.send(data)
  }

  paste(text: string) {
    this.embed.paste(text)
  }

  wheel(up: boolean) {
    this.embed.wheel(up, Math.floor(this.cols / 2), Math.floor(this.rows / 2))
  }

  resize(cols: number, rows: number) {
    this.cols = clamp(cols, 20, 200)
    this.rows = clamp(rows, 8, 120)
    this.embed.resize(this.cols, this.rows)
    this.sent = []
  }

  // The phone came back to the foreground: take the width again, and send the whole screen.
  reclaim() {
    this.embed.reclaim()
    this.sent = []
  }

  close() {
    this.embed.close()
  }
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(n) ? Math.floor(n) : lo))
