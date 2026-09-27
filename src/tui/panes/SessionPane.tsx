import { Text } from 'ink'
import { useEffect, useState } from 'react'

import type { EmbeddedSession, Seg } from '../embed.ts'
import { Frame } from '../panels/primitives.tsx'
import type { Sel } from '../state.ts'

// Splits a row's runs so the cells in [from, to) show selected.
export function highlightRow(segs: Seg[], from: number, to: number): Seg[] {
  const out: Seg[] = []
  let x = 0
  for (const sg of segs) {
    const end = x + sg.text.length
    const cuts = [x, Math.max(x, Math.min(end, from)), Math.max(x, Math.min(end, to)), end]
    for (let i = 0; i < 3; i++) {
      const a = cuts[i]!
      const b = cuts[i + 1]!
      if (b > a) {
        out.push({
          ...sg,
          text: sg.text.slice(a - x, b - x),
          ...(i === 1 ? { inverse: !sg.inverse } : {}),
        })
      }
    }
    x = end
  }
  return out
}

function withSelection(rows: Seg[][], selection: Sel): Seg[][] {
  const { a, b } = selection
  const [s, e] = a.row < b.row || (a.row === b.row && a.col <= b.col) ? [a, b] : [b, a]
  return rows.map((r, y) =>
    y < s.row || y > e.row
      ? r
      : highlightRow(r, y === s.row ? s.col : 0, y === e.row ? e.col + 1 : Number.MAX_SAFE_INTEGER),
  )
}

// The embedded conversation. It redraws itself when Claude writes, so a busy conversation
// doesn't redraw the rest of Hopper with it.
export function SessionPane(props: {
  session: EmbeddedSession
  focused: boolean
  width: number
  height: number
  selection?: Sel | null
}) {
  const { session, focused, width, height, selection } = props
  const [, redraw] = useState(0)
  useEffect(() => session.subscribe(() => redraw((n) => n + 1)), [session])
  const screen = session.screen()
  const rows = selection ? withSelection(screen, selection) : screen
  return (
    <Frame
      title="CONVERSATION"
      meta={`${session.name} · ${session.account.name}${focused ? ' · esc back to Hopper' : ' · ⏎ to type here'}`}
      width={width}
      height={height}
      focused={focused}
      inset="none"
    >
      {rows.map((r, y) => (
        <Text key={y} wrap="truncate-end">
          {r.length
            ? r.map((s, i) => (
                <Text
                  key={i}
                  color={s.fg}
                  backgroundColor={s.bg}
                  bold={s.bold}
                  dimColor={s.dim}
                  italic={s.italic}
                  underline={s.underline}
                  inverse={s.inverse}
                >
                  {s.text}
                </Text>
              ))
            : ' '}
        </Text>
      ))}
    </Frame>
  )
}
