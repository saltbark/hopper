import { Text } from 'ink'

import { cell, when, wrapText } from '../../../format.ts'
import { nextRun, type Result, type Routine, type Run } from '../../../routines/index.ts'
import { routineKeys } from '../../keymap.ts'
import { T } from '../../theme.ts'
import { Heading, Keys } from '../primitives.tsx'
import { row, title } from './parts.tsx'

export type RoutineView = {
  routine: Routine
  runs: Run[] // newest first
  results: Record<string, Result | null>
  account?: string | undefined
  now: number
}

// What a run came to, in a word and a colour.
function outcome(run: Run, res: Result | null | undefined) {
  if (run.status === 'skipped') return { text: 'skipped', color: T.faint, what: run.reason ?? '' }
  if (run.status === 'passed') return { text: 'passed', color: T.dim, what: 'the check passed' }
  if (res?.needs === 'you') return { text: 'needs you', color: T.waiting, what: res.summary }
  if (res?.needs === 'nothing') return { text: 'nothing', color: T.dim, what: res.summary }
  return { text: 'no result', color: T.faint, what: '' }
}

export function RoutineDetail({ view, width }: { view: RoutineView; width: number }) {
  const { routine: r, runs, results, now } = view
  const next = r.enabled ? nextRun(r.schedule, new Date(now)) : null
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
        .slice(0, 4)
        .map((l, i) => (
          <Text key={i} color={T.text} wrap="truncate-end">
            {l || ' '}
          </Text>
        ))}
      <Text> </Text>
      <Heading label={runs.length ? 'runs' : 'runs · none yet'} width={width} />
      {runs.slice(0, 8).map((run, i) => {
        const o = outcome(run, run.result ? results[run.result] : null)
        return (
          <Text key={i} wrap="truncate-end">
            <Text color={T.dim}>{cell(when(run.at), 18)}</Text>
            <Text color={o.color}>{cell(o.text, 11)}</Text>
            <Text color={T.text}>{o.what}</Text>
          </Text>
        )
      })}
      <Text> </Text>
      <Keys keys={routineKeys({ ...r, paused: !r.enabled })} width={width} />
    </>
  )
}
