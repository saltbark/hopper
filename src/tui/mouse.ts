// Mouse input. With reporting on, the terminal sends real wheel and click events instead of
// turning the wheel into arrow keys (which is what made Claude say "Scroll wheel is sending
// arrow keys"). SGR format: ESC [ < button ; column ; row M (press) or m (release), 1-based.

// 1003 reports clicks and every movement, a button held (drag-to-select) or not (hover); 1006
// is SGR. Terminals send a flood of movement with it, so whatever acts on a move only changes
// state when the row under the pointer does.
export const MOUSE_ON = '\x1b[?1003h\x1b[?1006h'
export const MOUSE_OFF = '\x1b[?1003l\x1b[?1006l'

export type MouseEvent = {
  kind: 'wheel-up' | 'wheel-down' | 'press' | 'drag' | 'move' | 'release' | 'other'
  x: number
  y: number
}

// Ink strips the leading ESC before handing input over, so it isn't part of the pattern.
const SGR = /\[<(\d+);(\d+);(\d+)([Mm])/g

// Ink hands the sequence over as text (without its ESC). Returns null for anything else.
export function parseMouse(input: string): MouseEvent[] | null {
  const events: MouseEvent[] = []
  for (const m of input.matchAll(SGR)) {
    const button = Number(m[1])
    const x = Number(m[2])
    const y = Number(m[3])
    const base = button & ~(4 | 8 | 16) // drop shift/meta/ctrl bits
    const kind =
      base === 64
        ? 'wheel-up'
        : base === 65
          ? 'wheel-down'
          : base >= 32 && base <= 34
            ? 'drag' // movement with a button held
            : base === 35
              ? 'move' // movement with none
              : base <= 2
                ? m[4] === 'm'
                  ? 'release'
                  : 'press'
                : 'other'
    events.push({ kind, x, y })
  }
  return events.length ? events : null
}
