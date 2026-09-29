import { basename } from 'node:path'

import { Box, Text } from 'ink'
import { createElement, useEffect, useState, type ReactNode } from 'react'

import type { Config } from '../../config.ts'
import { OTHER, type Item } from '../../model.ts'
import { ACCOUNT_COLORS, dimLine, SPIN_FRAMES, SPIN_MS, stateMark, T } from '../theme.ts'

// The pieces every panel is built from: the frame, list windowing, the glyphs that lead a row,
// key caps and headings.

// A panel. Ink has no border titles, so the box draws three sides and this draws the top edge
// with the title, the key that jumps here, and a note at the right: ╭─ TITLE (k) ──── note ─╮.
// `inset` is what sits inside the left border: a space (text), nothing (lists draw their own
// selection rail there), or nothing on either side (the embedded conversation).
export function Frame(props: {
  title: string
  keyHint?: string
  meta?: string
  width: number
  height: number
  focused?: boolean
  // Drawn a step darker (dimLine): a panel on the board that hasn't got the keys.
  dimmed?: boolean
  inset?: 'text' | 'rail' | 'none'
  children?: ReactNode
}) {
  const { title, keyHint, meta, width, height, focused, dimmed, inset = 'text', children } = props
  const edge = focused ? T.focus : T.line
  const head = ` ${title} `
  const key = keyHint ? `(${keyHint}) ` : ''
  const room = Math.max(0, width - 4 - head.length - key.length)
  const metaMax = room - 3
  const note =
    meta && metaMax >= 2
      ? ` ${meta.length > metaMax ? meta.slice(0, metaMax - 1) + '…' : meta} `
      : ''
  return (
    <Dim on={!!dimmed} width={width} height={height}>
      <Text wrap="truncate-end">
        <Text color={edge}>╭─</Text>
        <Text color={focused ? T.focus : T.dim} bold={focused}>
          {head}
        </Text>
        {key ? <Text color={focused ? T.dim : T.faint}>{key}</Text> : null}
        <Text color={edge}>{'─'.repeat(Math.max(0, room - note.length))}</Text>
        <Text color={T.dim}>{note}</Text>
        <Text color={edge}>─╮</Text>
      </Text>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderTop={false}
        borderColor={edge}
        paddingLeft={inset === 'text' ? 1 : 0}
        paddingRight={inset === 'none' ? 0 : 1}
        overflow="hidden"
      >
        {children}
      </Box>
    </Dim>
  )
}

// Frame's outer box. Ink runs a box's transform over every line of text inside it, after the
// text's own colours; only its internal element takes one, so this is that element with the
// style Box would give it.
function Dim(props: { on: boolean; width: number; height: number; children: ReactNode }) {
  const { on, width, height, children } = props
  const style = {
    flexWrap: 'nowrap',
    flexDirection: 'column',
    flexGrow: 0,
    flexShrink: 1,
    width,
    height,
  }
  return createElement('ink-box', { style, internal_transform: on ? dimLine : undefined }, children)
}

export function windowed<T>(items: T[], sel: number, n: number): { start: number; slice: T[] } {
  if (n <= 0) return { start: 0, slice: [] }
  const start = Math.max(0, Math.min(sel - Math.floor(n / 2), items.length - n))
  return { start, slice: items.slice(start, start + n) }
}

export const accountColor = (config: Config, name: string): string =>
  ACCOUNT_COLORS[
    Math.max(
      0,
      config.accounts.findIndex((a) => a.name === name),
    ) % ACCOUNT_COLORS.length
  ] ?? T.text

export const where = (i: Item) => (i.key === OTHER ? '~/' + basename(i.cwd) : i.key)

// One clock for every spinner on screen, so they turn together and stop when none are shown.
let spinFrame = 0
const spinners = new Set<() => void>()
let spinTimer: ReturnType<typeof setInterval> | null = null
function useSpinFrame() {
  const [, redraw] = useState(0)
  useEffect(() => {
    const tick = () => redraw((n) => n + 1)
    spinners.add(tick)
    spinTimer ??= setInterval(() => {
      spinFrame = (spinFrame + 1) % SPIN_FRAMES.length
      for (const s of spinners) s()
    }, SPIN_MS)
    return () => {
      spinners.delete(tick)
      if (!spinners.size && spinTimer) {
        clearInterval(spinTimer)
        spinTimer = null
      }
    }
  }, [])
  return spinFrame
}

function Spinner({ color, bg }: { color: string; bg?: string | undefined }) {
  const frame = useSpinFrame()
  return (
    <Text color={color} backgroundColor={bg}>
      {SPIN_FRAMES[frame]}
    </Text>
  )
}

// The glyph that leads a row and says what the item is doing.
export function Mark({ state, kind, bg }: { state: string; kind?: string; bg?: string }) {
  const { mark, color, bold } = stateMark(state, kind)
  if (mark === 'spin') return <Spinner color={color} bg={bg} />
  return (
    <Text color={color} backgroundColor={bg} bold={bold}>
      {mark}
    </Text>
  )
}

// A list row's first cell: the selection rail when the list has focus, else a space.
export function Rail({ on, bg }: { on: boolean; bg?: string | undefined }) {
  return (
    <Text color={T.focus} backgroundColor={bg}>
      {on ? '▌' : ' '}
    </Text>
  )
}

// Actions as key caps: ` ⏎ ` open  ` m ` mark done.
// Given a width, they run onto as many lines as they need.
export function keyLines(keys: [string, string][], width?: number): [string, string][][] {
  const lines: [string, string][][] = [[]]
  let used = 0
  for (const kd of keys) {
    const w = kd[0].length + kd[1].length + 6
    if (width && used && used + w > width) {
      lines.push([])
      used = 0
    }
    lines.at(-1)!.push(kd)
    used += w
  }
  return lines
}

export function Keys({ keys, width }: { keys: [string, string][]; width?: number }) {
  const lines = keyLines(keys, width)
  return (
    <>
      {lines.map((line, n) => (
        <Text key={n} wrap="truncate-end">
          {line.map(([k, d], i) => (
            <Text key={i}>
              <Text backgroundColor={T.cap} color={T.text}>{` ${k} `}</Text>
              <Text color={T.dim}>{` ${d}   `}</Text>
            </Text>
          ))}
        </Text>
      ))}
    </>
  )
}

// A rule with a label: OPEN IN META/INBOX ───────
export function Heading({
  label,
  width,
  color = T.dim,
}: {
  label: string
  width: number
  color?: string
}) {
  return (
    <Text wrap="truncate-end">
      <Text color={color}>{label.toUpperCase() + ' '}</Text>
      <Text color={T.line}>{'─'.repeat(Math.max(0, width - label.length - 1))}</Text>
    </Text>
  )
}
