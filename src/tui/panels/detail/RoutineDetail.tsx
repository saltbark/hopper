import { Text } from 'ink'

import { when, wrapText } from '../../../format.ts'
import { nextRun, type Report, type Routine, type Run } from '../../../routines/index.ts'
import { routineKeys } from '../../keymap.ts'
import { T } from '../../theme.ts'
import { Heading, keyLines, Keys, Rail, windowed } from '../primitives.tsx'
import { row, title } from './parts.tsx'

export type RoutineView = {
  routine: Routine
  reports: Report[] // newest first
  // Its newest run that started or passed; skipped runs don't count.
  last?: Run | undefined
  account?: string | undefined
  now: number
}

const PROMPT_LINES = 4

const keysFor = (r: Routine) => routineKeys({ ...r, paused: !r.enabled })

// Where the list sits in the panel, which the mouse reads too: the prompt's line, then the line
// the report rows start on, and which of them show. `sel` is set while the list has the
// keyboard (-1 the prompt's line); then the key bar carries its keys, the panel doesn't list
// the routine's, and the rows follow the selection.
export function reportRows(view: RoutineView, width: number, height: number, sel?: number) {
  const { routine: r, reports } = view
  const prompt = Math.min(PROMPT_LINES, wrapText(r.prompt, width).length)
  const rows = 6 + (r.check ? 1 : 0) + (view.account ? 1 : 0)
  const edit = rows + 1 + 1 + prompt
  const top = edit + 1 + 1 + 1
  const tail = sel === undefined ? 1 + keyLines(keysFor(r), width).length : 0
  const room = Math.max(1, height - top - tail)
  if (sel !== undefined) return { edit, top, ...windowed(reports, Math.max(0, sel), room), more: 0 }
  // Unfocused, the newest show and a line says how many more there are.
  const fits = reports.length <= room
  const slice = reports.slice(0, fits ? room : room - 1)
  return { edit, top, start: 0, slice, more: reports.length - slice.length }
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
  const unread = reports.filter((x) => x.unread).length
  return (
    <>
      {title('↻ ' + r.name)}
      {row('runs', r.schedule || 'only when you run it', r.schedule ? T.text : T.dim)}
      {row(
        'last',
        view.last ? `${when(view.last.at)} · ${view.last.status}` : 'never',
        view.last ? T.text : T.dim,
      )}
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
      <Text wrap="truncate-end">
        <Rail on={sel === -1} bg={sel === -1 ? T.sel : undefined} />
        <Text color={sel === -1 ? T.hi : T.dim} backgroundColor={sel === -1 ? T.sel : undefined}>
          {'  edit the prompt'}
        </Text>
      </Text>
      <Text> </Text>
      <Heading
        label={
          !reports.length ? 'reports · none yet' : unread ? `reports · ${unread} unread` : 'reports'
        }
        width={width}
        color={focused ? T.focus : T.dim}
      />
      {slice.map((rep, i) => {
        const lit = focused && start + i === sel
        const bg = lit ? T.sel : undefined
        return (
          <Text key={rep.path} wrap="truncate-end">
            <Rail on={lit} bg={bg} />
            {/* Unread shows as a dot; the time is what tells reports apart, so it's never cut. */}
            <Text color={T.focus} backgroundColor={bg}>
              {rep.unread ? '● ' : '  '}
            </Text>
            <Text color={lit ? T.hi : T.dim} backgroundColor={bg}>
              {when(rep.at) + '  '}
            </Text>
            <Text
              color={lit ? T.hi : rep.unread ? T.text : T.dim}
              backgroundColor={bg}
              bold={!!rep.unread && !lit}
            >
              {rep.summary || 'report'}
            </Text>
          </Text>
        )
      })}
      {more > 0 ? (
        <Text color={T.dim} wrap="truncate-end">
          {slice.length ? `  … ${more} older · ⏎ for all` : `  ${more} reports · ⏎ to read them`}
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
