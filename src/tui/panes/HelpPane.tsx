import { Box, Text } from 'ink'
import type { ReactNode } from 'react'

import type { Config } from '../../config.ts'
import { tildify } from '../../paths.ts'
import {
  ANYWHERE,
  CONVERSATION_KEYS,
  draftKeys,
  hereKeys,
  MOUSE_KEYS,
  PANEL_KEYS,
  REPORTS_HELP,
  routineKeys,
  SETTINGS_KEYS,
  WRITING_KEYS,
  type Here,
  type Hint,
} from '../keymap.ts'
import { Frame } from '../panels/primitives.tsx'
import { T } from '../theme.ts'

// Every key, in sections laid out as columns: a heading, then one key a line, keys right-aligned
// against their descriptions. The section for where you were when you pressed ? is lit. Taller
// than the screen, it scrolls.

const SECTIONS: [label: string, hints: Hint[]][] = [
  ['anywhere', ANYWHERE],
  ...PANEL_KEYS,
  ['a draft', draftKeys({})],
  ['a routine', routineKeys({})],
  ['writing', WRITING_KEYS],
  ['a conversation', CONVERSATION_KEYS],
  ['routine reports', REPORTS_HELP],
  ['settings', SETTINGS_KEYS],
  ['mouse', MOUSE_KEYS],
]

const GAP = 4
const MIN_COL = 42
const MAX_COLS = 3
// The frame's edges and padding, and the two lines of notes under the columns.
const FRAME_W = 4
const FRAME_H = 2
const FOOT_H = 3

// A section's lines: its heading, its keys, and a blank line after.
const sectionH = (hints: Hint[]) => hints.length + 2

// Split the sections, in order, into at most n columns as even in height as they go.
function columns(n: number): number[][] {
  const hs = SECTIONS.map(([, h]) => sectionH(h))
  const total = hs.reduce((a, b) => a + b, 0)
  for (let cap = Math.max(...hs, Math.ceil(total / n)); ; cap++) {
    const cols: number[][] = [[]]
    let used = 0
    hs.forEach((h, i) => {
      if (used + h > cap && cols.at(-1)!.length) {
        cols.push([])
        used = 0
      }
      cols.at(-1)!.push(i)
      used += h
    })
    if (cols.length <= n) return cols
  }
}

function layout(width: number, height: number) {
  const inner = width - FRAME_W
  const n = Math.max(1, Math.min(MAX_COLS, Math.floor((inner + GAP) / (MIN_COL + GAP))))
  const cols = columns(n)
  const colW = Math.floor((inner - GAP * (cols.length - 1)) / cols.length)
  const tallest = Math.max(...cols.map((c) => c.reduce((a, i) => a + sectionH(SECTIONS[i]![1]), 0)))
  const visible = Math.max(1, height - FRAME_H - FOOT_H)
  return { cols, colW, visible, maxScroll: Math.max(0, tallest - 1 - visible) }
}

// Keys are right-aligned to the widest in their column, so a column's descriptions line up.
const keyWidth = (col: number[]) =>
  Math.max(...col.flatMap((i) => SECTIONS[i]![1].map(([k]) => k.length)))

// How far the help screen can scroll, for the keys that scroll it.
export const helpMaxScroll = (width: number, height: number) => layout(width, height).maxScroll

// Which section is lit: the one for where you are. A draft or a routine selected in the list is
// its own section.
function hereLabel(here: Here): string {
  const label = hereKeys(here).label
  if (label === 'the list' && here.item?.kind === 'draft') return 'a draft'
  if (label === 'the list' && here.item?.kind === 'routine') return 'a routine'
  if (label === 'a report' || label === 'routine') return 'routine reports'
  return label
}

function sectionLines(
  label: string,
  hints: Hint[],
  lit: boolean,
  keyW: number,
  colW: number,
): ReactNode[] {
  const lines: ReactNode[] = [
    <Text key="h" wrap="truncate-end">
      <Text color={lit ? T.focus : T.dim} bold>
        {label.toUpperCase()}
      </Text>
      {lit ? <Text color={T.dim}>{'  you are here'}</Text> : null}
    </Text>,
  ]
  hints.forEach(([k, d], i) =>
    lines.push(
      <Text key={i} wrap="truncate-end">
        <Text color={T.hi} bold>
          {k.padStart(keyW)}
        </Text>
        <Text color={T.text}>{'  ' + d}</Text>
      </Text>,
    ),
  )
  lines.push(<Text key="gap"> </Text>)
  return lines.map((l, i) => (
    <Box key={`${label}-${i}`} width={colW} height={1} flexShrink={0}>
      {l}
    </Box>
  ))
}

export function HelpPane({
  config,
  here,
  scroll,
  width,
  height,
}: {
  config: Config
  here: Here
  scroll: number
  width: number
  height: number
}) {
  const { cols, colW, visible, maxScroll } = layout(width, height)
  const top = Math.max(0, Math.min(scroll, maxScroll))
  const lit = hereLabel(here)
  const more = top < maxScroll
  const meta = maxScroll ? 'j k scroll · any other key closes' : 'any key closes'
  return (
    <Frame title="KEYS" meta={meta} width={width} height={height} focused>
      <Box flexDirection="row" height={visible} flexShrink={0}>
        {cols.map((col, c) => (
          <Box
            key={c}
            flexDirection="column"
            width={colW}
            marginLeft={c ? GAP : 0}
            flexShrink={0}
            overflow="hidden"
          >
            {col
              .flatMap((i) => {
                const [label, hints] = SECTIONS[i]!
                return sectionLines(label, hints, label === lit, keyWidth(col), colW)
              })
              .slice(top, top + visible)}
          </Box>
        ))}
      </Box>
      <Text color={T.dim} wrap="truncate-end">
        {more ? '↓ more · ' : ''}Letters act on the focused panel; esc goes back. Ask Claude in a
        conversation to file items; it knows the project’s _open.md.
      </Text>
      <Text> </Text>
      <Text color={T.faint} wrap="truncate-end">
        config {tildify(config.path)} · accounts {tildify(config.accountsPath)} · home{' '}
        {tildify(config.home)}
      </Text>
    </Frame>
  )
}
