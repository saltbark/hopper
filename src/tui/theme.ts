// Hopper's colours, in one place so no panel names a colour of its own. Hex, so they look the
// same whatever the terminal's theme; chalk drops them to the nearest of 256 where truecolor isn't
// there. They assume a dark background.
//
// Brightness is how the eye is steered, so it comes in a few fixed steps and each has one job:
// `hi` is only for the thing you are on, `text` is content, `dim` is what explains the content
// (labels, where, ages, key descriptions), `faint` is what you look for rather than read (keys in
// titles, zero counts), and `line` is structure. Colour is for state, and only on its glyph or
// heading, never on a whole row.
export const T = {
  hi: '#f1f4f2',
  text: '#c7cfca',
  dim: '#66706b',
  faint: '#505a57',
  line: '#3e494f',
  focus: '#6fcac3',
  // Behind the selected row, behind a key cap, and the text on a filled chip.
  sel: '#243039',
  // Behind the row under the pointer: a step short of the selection.
  hover: '#1a2227',
  cap: '#2a3337',
  onFill: '#0a0c0d',
  waiting: '#e5c06a',
  blocked: '#ec7a6f',
  draft: '#c69ce8',
  running: '#7fcf8f',
} as const

// Accounts are told apart by colour; soft enough to sit next to the state colours.
export const ACCOUNT_COLORS = ['#7eaaea', '#c69ce8', '#6fcac3', '#e5c06a'] as const

// The 16 basic terminal colours, for the conversation drawn in the right panel. Claude sends
// some of its colours as these rather than as hex, and xterm's stock values (#00cd00 and the
// like) shout next to everything else; these are Hopper's state colours, a step brighter for the
// bright half. Order: black, red, green, yellow, blue, magenta, cyan, white, then bright of each.
export const ANSI = [
  T.onFill,
  T.blocked,
  T.running,
  T.waiting,
  '#7eaaea',
  T.draft,
  T.focus,
  T.text,
  T.dim,
  '#f29a90',
  '#a3dcae',
  '#eed28f',
  '#a3c3f0',
  '#d8b9ef',
  '#96d8d3',
  T.hi,
] as const

// Meters: calm until a limit gets close.
export const tone = (pct: number) => (pct >= 90 ? T.blocked : pct >= 75 ? T.waiting : T.running)

// What an item is doing, as the glyph that leads its row.
export function stateMark(
  state: string,
  kind?: string,
): { mark: string; color: string; bold?: boolean } {
  // Queued drafts: ○ to start when there's room, ☾ tonight.
  if (state === 'queued') return { mark: '○', color: T.dim }
  if (state === 'tonight') return { mark: '☾', color: T.dim }
  if (kind === 'draft' || state === 'draft') return { mark: '◇', color: T.draft }
  if (kind === 'routine')
    return state === 'paused' ? { mark: '○', color: T.dim } : { mark: '↻', color: T.focus }
  // Waiting on you: a question is your turn, not a fault, so only a failure is red.
  if (state === 'blocked') return { mark: '?', color: T.waiting, bold: true }
  if (state === 'failed' || state === 'stopped') return { mark: '✕', color: T.blocked }
  if (state === 'done') return { mark: '✓', color: T.waiting }
  return { mark: 'spin', color: T.running }
}

export const SPIN_FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
export const SPIN_MS = 120
