import type { Account } from '../config.ts'
import { EmbeddedSession, type Seg } from '../tui/embed.ts'
import { T } from '../tui/theme.ts'

// A conversation open on the phone. The Mac runs its own `claude attach` (the same
// EmbeddedSession the right panel uses) at the phone's width and TALL rows high, and sends the
// screen as rows of styled runs; only the rows that changed go after the first. Claude draws its
// whole conversation into a screen that tall (from the top, its prompt pinned to the bottom), so
// the phone scrolls it natively, with no round trip per swipe; only history older than that needs
// Claude to scroll (`wheel`).
//
// A conversation draws at one size, the last attach client's: the side someone types or scrolls
// on takes it back on the first key (`claim` in embed.ts). `mine` tells the phone whether the
// screen it has was drawn for it.

export const TALL = 400

// After a paste, how long before Enter: sent together, Claude takes the Enter as part of the paste
// (a new line in it), not as sending it.
export const SUBMIT_GAP_MS = 120

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
  // Whether the conversation is drawn at the phone's size, not the Mac panel's.
  mine: boolean
}

export function runs(segs: Seg[]): Run[] {
  // A row of nothing but spaces is sent empty: most of a tall screen is blank.
  if (segs.every((s) => !s.text.trim() && !s.bg && !s.inverse)) return []
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
  | 'hasSize'
>

const realSpawn: Spawn = (account, id, name, cols, rows, events) =>
  new EmbeddedSession(account, id, name, cols, rows, events)

export class PhoneScreen {
  private readonly embed: ReturnType<Spawn>
  private sent: string[] = []
  private sentMine: boolean | null = null
  private cols: number
  private readonly rows = TALL

  constructor(
    readonly target: Target,
    cols: number,
    private readonly out: (frame: ScreenFrame | { t: 'closed'; id: string }) => void,
    spawn: Spawn = realSpawn,
  ) {
    this.cols = clamp(cols, 20, 200)
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
    const mine = this.embed.hasSize()
    const set: [number, Run[]][] = []
    rows.forEach((r, i) => {
      if (full || r !== this.sent[i]) set.push([i, JSON.parse(r) as Run[]])
    })
    if (!set.length && mine === this.sentMine) return
    this.sent = rows
    this.sentMine = mine
    const c = this.embed.cursor()
    this.out({
      t: 'screen',
      id: this.id,
      cols: this.cols,
      rows: this.rows,
      set,
      full,
      cursor: c ? [c.col, c.row] : null,
      mine,
    })
  }

  keys(data: string) {
    this.embed.send(data)
  }

  paste(text: string) {
    this.embed.paste(text)
  }

  // What was typed, then Enter a moment later, so Claude sends it rather than adding a new line.
  submit(text: string, wait = SUBMIT_GAP_MS) {
    if (text) this.embed.paste(text)
    setTimeout(() => this.embed.send('\r'), text ? wait : 0)
  }

  wheel(up: boolean) {
    this.embed.wheel(up, Math.floor(this.cols / 2), Math.floor(this.rows / 2))
  }

  // Only the width follows the phone; the height stays TALL whatever the keyboard does.
  resize(cols: number) {
    this.cols = clamp(cols, 20, 200)
    this.embed.resize(this.cols, this.rows)
    this.sent = []
  }

  // Take the size back for the phone (it came back to the screen, or asked), and send it all.
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
