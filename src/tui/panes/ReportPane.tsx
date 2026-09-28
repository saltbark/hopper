import { Text } from 'ink'

import { when, wrapText } from '../../format.ts'
import type { Report } from '../../routines/index.ts'
import { outcome } from '../panels/detail/RoutineDetail.tsx'
import { Frame } from '../panels/primitives.tsx'
import { T } from '../theme.ts'

// A routine's report, open for reading in the right panel. Markdown is shown as its text:
// headings lit, everything else as written, wrapped to the panel.

type Line = { text: string; heading: boolean }

// The report's lines as the panel shows them. Its own "needs:" line is said in the header.
export function reportLines(text: string, width: number): Line[] {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\s*needs:.*\n?/i, '')
  const out: Line[] = []
  for (const raw of body.replace(/\s+$/, '').split('\n')) {
    const h = /^#{1,6}\s+(.*)$/.exec(raw)
    if (h) out.push({ text: h[1]!, heading: true })
    else for (const l of wrapText(raw, width)) out.push({ text: l, heading: false })
  }
  return out
}

// The panel's inside, less its two header lines: the room the report scrolls in.
const HEAD = 2
export const reportRoom = (height: number) => Math.max(1, height - 2 - HEAD)

// How far a report can scroll, for the keys that scroll it.
export const reportMaxScroll = (text: string, width: number, height: number) =>
  Math.max(0, reportLines(text, width - 4).length - reportRoom(height))

export function ReportPane(props: {
  routine: string
  report: Report
  text: string
  scroll: number
  // Where it sits among the routine's reports, newest first.
  index: number
  count: number
  width: number
  height: number
}) {
  const { routine, report, text, index, count, width, height } = props
  const w = width - 4
  const lines = reportLines(text, w)
  const room = reportRoom(height)
  const top = Math.max(0, Math.min(props.scroll, lines.length - room))
  const shown = lines.slice(top, top + room)
  const o = outcome(report)
  const below = lines.length - top - shown.length
  const meta = [
    `${index + 1} of ${count}`,
    lines.length > room ? (below ? `${below} more lines` : 'the end') : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Frame title="REPORT" meta={meta} width={width} height={height} focused>
      <Text wrap="truncate-end">
        <Text bold color={T.hi}>
          {'↻ ' + routine}
        </Text>
        <Text color={T.dim}>{'  ' + when(report.at) + '  '}</Text>
        <Text color={o.color}>{o.text}</Text>
      </Text>
      <Text> </Text>
      {shown.map((l, i) => (
        <Text key={top + i} wrap="truncate-end" bold={l.heading} color={l.heading ? T.hi : T.text}>
          {l.text || ' '}
        </Text>
      ))}
    </Frame>
  )
}
