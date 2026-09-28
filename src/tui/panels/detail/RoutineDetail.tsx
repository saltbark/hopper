import { Text } from 'ink'

import { cell, when, wrapText } from '../../../format.ts'
import { nextRun, type Report, type Routine } from '../../../routines/index.ts'
import { routineKeys } from '../../keymap.ts'
import { T } from '../../theme.ts'
import { Heading, keyLines, Keys, Rail, windowed } from '../primitives.tsx'
import { row, title } from './parts.tsx'

export type RoutineView = {
  routine: Routine
  reports: Report[] // newest first
  account?: string | undefined
  now: number
  // Its newest report needs you and you haven't opened its reports since.
  attention?: boolean | undefined
}

const PROMPT_LINES = 4

// What a report came to, in a word and a colour. A run whose check passed writes a report too.
export function outcome(r: Report) {
  if (r.needs === 'you') return { text: 'needs you', color: T.waiting }
  if (r.needs === 'nothing') return { text: 'nothing', color: T.dim }
  return { text: 'report', color: T.faint }
}

const keysFor = (r: Routine) => routineKeys({ ...r, paused: !r.enabled })

// Where the reports sit in the panel, which the mouse reads too: the line their rows start on,
// and which of them show. `sel` is set while the reports have the keyboard; then the key bar
// carries their keys, the panel doesn't list the routine's, and the rows follow the selection.
export function reportRows(view: RoutineView, width: number, height: number, sel?: number) {
  const { routine: r, reports } = view
  const prompt = Math.min(PROMPT_LINES, wrapText(r.prompt, width).length)
  const top = 5 + (view.account ? 1 : 0) + 1 + 1 + prompt + 1 + 1
  const tail = sel === undefined ? 1 + keyLines(keysFor(r), width).length : 0
  const room = Math.max(1, height - top - tail)
  if (sel !== undefined) return { top, ...windowed(reports, sel, room), more: 0 }
  // Unfocused, the newest show and a line says how many more there are.
  const fits = reports.length <= room
  const slice = reports.slice(0, fits ? room : room - 1)
  return { top, start: 0, slice, more: reports.length - slice.length }
}

export function RoutineDetail({
  view,
  width,
  height,
  sel,
}: {
  view: RoutineView
  width: number
  height: number
  sel?: number | undefined
}) {
  const { routine: r, reports, now } = view
  const next = r.enabled ? nextRun(r.schedule, new Date(now)) : null
  const { start, slice, more } = reportRows(view, width, height, sel)
  const focused = sel !== undefined
  return (
    <>
      {title('↻ ' + r.name)}
      {row('runs', r.schedule || 'only when you run it', r.schedule ? T.text : T.dim)}
      {row(
        'next',
        !r.enabled ? 'paused' : next ? when(next.getTime()) : '–',
        r.enabled ? T.text : T.waiting,
      )}
      {row('project', r.project)}
      {row('model', [r.model ?? 'project default', r.effort].filter(Boolean).join(' · '))}
      {r.check ? row('check', r.check) : null}
      {view.account ? row('account', view.account) : null}
      <Text> </Text>
      <Heading label="prompt" width={width} />
      {wrapText(r.prompt, width)
        .slice(0, PROMPT_LINES)
        .map((l, i) => (
          <Text key={i} color={T.text} wrap="truncate-end">
            {l || ' '}
          </Text>
        ))}
      <Text> </Text>
      <Heading
        label={
          !reports.length
            ? 'reports · none yet'
            : view.attention
              ? 'reports · the newest needs you · o'
              : 'reports'
        }
        width={width}
        color={focused ? T.focus : view.attention ? T.waiting : T.dim}
      />
      {slice.map((rep, i) => {
        const o = outcome(rep)
        const lit = focused && start + i === sel
        const bg = lit ? T.sel : undefined
        return (
          <Text key={rep.path} wrap="truncate-end">
            <Rail on={lit} bg={bg} />
            <Text color={lit ? T.hi : T.dim} backgroundColor={bg}>
              {cell(when(rep.at), 18)}
            </Text>
            <Text color={o.color} backgroundColor={bg}>
              {cell(o.text, 11)}
            </Text>
            <Text color={lit ? T.hi : T.text} backgroundColor={bg}>
              {rep.summary || ' '}
            </Text>
          </Text>
        )
      })}
      {more > 0 ? (
        <Text color={T.dim} wrap="truncate-end">
          {slice.length ? `  … ${more} older · o for all` : `  ${more} reports · o to read them`}
        </Text>
      ) : null}
      {focused ? null : (
        <>
          <Text> </Text>
          <Keys keys={keysFor(r)} width={width} />
        </>
      )}
    </>
  )
}
