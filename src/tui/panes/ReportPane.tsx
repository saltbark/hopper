import { Text } from 'ink'

import { when } from '../../format.ts'
import type { Report } from '../../routines/index.ts'
import { type Line, markdownLines } from '../markdown.ts'
import { Frame } from '../panels/primitives.tsx'
import { T } from '../theme.ts'

// A routine's report, open for reading in the right panel, its markdown laid out
// (`markdown.ts`) and wrapped to the panel.

// The last layout, for the scroll keys and the render that follow one another at the same width.
let last: { text: string; width: number; lines: Line[] } | undefined

// The report's lines as the panel shows them, less an older report's "needs:" line.
export function reportLines(text: string, width: number): Line[] {
  if (last?.text === text && last.width === width) return last.lines
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\s*needs:.*\n?/i, '')
  const lines = markdownLines(body, width)
  last = { text, width, lines }
  return lines
}

// A terminal hyperlink around the text (OSC 8): the URL opens on a click where the terminal
// supports it, and shows as nothing where it doesn't.
const hyperlink = (url: string, text: string) => `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`

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
        <Text color={T.dim}>{'  ' + when(report.at)}</Text>
      </Text>
      <Text> </Text>
      {shown.map((l, i) => (
        <Text key={top + i} wrap="truncate-end" color={T.text}>
          {l.length
            ? l.map((s, j) => (
                <Text
                  key={j}
                  bold={s.bold}
                  italic={s.italic}
                  strikethrough={s.strike}
                  color={s.color}
                >
                  {s.link ? hyperlink(s.link, s.text) : s.text}
                </Text>
              ))
            : ' '}
        </Text>
      ))}
    </Frame>
  )
}
