import { Box, Text } from 'ink'
import type { ReactNode } from 'react'

import type { Update } from '../../update.ts'
import { barKeys, hereKeys, type Hint, type Here } from '../keymap.ts'
import { againKeys, FORM_PROMPT, type Editing, type Form } from '../state.ts'
import { T } from '../theme.ts'

// A mode that changes what keys do says so at the left of the key bar.
const chip = (label: string) => (
  <Text backgroundColor={T.focus} color={T.onFill} bold>{` ${label} `}</Text>
)

const keys = (list: Hint[]) =>
  list.map(([k, d], i) => (
    <Text key={i}>
      <Text color={T.text}>{k}</Text>
      <Text color={T.dim}>{` ${d}   `}</Text>
    </Text>
  ))

const hintText = (list: Hint[]) => list.map(([k, d]) => `${k} ${d}`).join(' · ')

// After the keys for where you are, a few that work from anywhere. The line truncates from the
// end; ? sits at the right, so it never does. → and ← come first: in and out
// of a conversation is the move made most.
const GLOBAL: Hint[] = [
  ['→ ←', 'open and back'],
  ['p', 'find a project'],
  ['tab', 'new conversation'],
  ['n', 'next waiting'],
  ['x x', 'quit'],
]

const note = (message: string | null, hint: string) =>
  message ? (
    <Text color={T.waiting}>{'  ' + message}</Text>
  ) : (
    <Text color={T.dim}>{'  ' + hint}</Text>
  )

function FormBar({ form }: { form: Form }) {
  const removing =
    form.kind === 'remove' ||
    form.kind === 'routine-remove' ||
    form.kind === 'draft-remove' ||
    form.kind === 'setting-remove'
  const label = removing
    ? 'remove'
    : form.kind === 'add-name' || form.kind === 'add-dir'
      ? 'add account'
      : form.kind === 'routine-name'
        ? 'new routine'
        : form.kind === 'setting-add-source'
          ? 'add source'
          : form.kind === 'setting-add-project'
            ? 'add project'
            : form.name
  return (
    <Text wrap="truncate-end">
      {chip(label)}
      {removing ? (
        <Text color={T.text}>
          {form.kind === 'remove'
            ? `  Remove ${form.name} from Hopper? Its login and sessions stay.  `
            : form.kind === 'setting-remove'
              ? `  Remove ${form.name} from projects.toml?  `
              : form.kind === 'draft-remove'
                ? `  Throw away the draft ${form.name}?  `
                : `  Remove the routine ${form.name}? Its schedule stops; past runs stay.  `}
          <Text bold color={T.hi}>
            {againKeys(form).join(' or ')}
          </Text>
          <Text color={T.dim}>
            {form.kind === 'draft-remove' ? ' again throws it away' : ' again removes it'} · any
            other key keeps it
          </Text>
        </Text>
      ) : (
        <Text color={T.text}>
          <Text color={T.dim}>{`  ${FORM_PROMPT[form.kind]}: `}</Text>
          {form.value}
          <Text inverse> </Text>
          <Text color={T.dim}>{'  ⏎ ok · esc cancel'}</Text>
        </Text>
      )}
    </Text>
  )
}

function editingHint(e: Editing, here: Here): string {
  if (e.stage === 'pick') return 'type to filter · ↑↓ choose · tab or ⏎ picks · esc back'
  return `type · ${hintText(hereKeys(here).hints)}`
}

type BarProps = {
  form: Form | null
  editing: Editing | null
  // What's typed in Projects, while it has the keys.
  query: string
  here: Here
  message: string | null
  error: string | null
}

// While z is holding the Mac awake, the line ends in "awake", whatever is on screen: in its own
// colour, so it never takes the colour of the text beside it, and one cell in from the edge, as
// the line starts. A word rather than a symbol: an emoji is drawn small, and narrower than Ink
// counts it, by terminals that take it from a text font.
const awakeMark = <Text color={T.running}>awake</Text>

// A newer Hopper (update.ts) sits just before it, in blue: V installs it, then it waits for
// Hopper to be opened again.
const updateMark = (u: Update) =>
  u.stage === 'available' ? (
    <Text>
      <Text color={T.text}>V</Text>
      <Text color={T.update}>{` update to ${u.version}`}</Text>
    </Text>
  ) : (
    <Text color={T.update}>
      {u.stage === 'installing' ? `installing ${u.version}…` : `reopen for ${u.version}`}
    </Text>
  )

// Each mark after two spaces; null when there are none.
const marksOf = (awake: boolean, update: Update | null) =>
  awake || update ? (
    <Text>
      {update ? (
        <Text>
          {'  '}
          {updateMark(update)}
        </Text>
      ) : null}
      {awake ? (
        <Text>
          {'  '}
          {awakeMark}
        </Text>
      ) : null}
    </Text>
  ) : null

// A line with nothing of its own at the right gets the marks there.
const withMarks = (marks: ReactNode, line: ReactNode) =>
  marks ? (
    <Box justifyContent="space-between">
      <Box flexShrink={1} minWidth={0}>
        {line}
      </Box>
      <Box flexShrink={0}>
        <Text>{marks} </Text>
      </Box>
    </Box>
  ) : (
    line
  )

// The bottom line: what the keys do right now, or the last message.
export function KeyBar(props: BarProps & { awake: boolean; update: Update | null }) {
  const { form, editing, query, here, message, error, awake, update } = props
  const { focus } = here
  const marks = marksOf(awake, update)
  if (form) return withMarks(marks, <FormBar form={form} />)
  if (editing) {
    return withMarks(
      marks,
      <Text wrap="truncate-end">
        {chip(editing.routine ? 'routine' : 'draft')}
        <Text color={T.text}>{` ${editing.project}`}</Text>
        {note(message, editingHint(editing, here))}
      </Text>,
    )
  }
  if (here.setting !== undefined) {
    return withMarks(
      marks,
      <Text wrap="truncate-end">
        {chip('settings')}{' '}
        {message ? <Text color={T.waiting}>{' ' + message}</Text> : keys(barKeys(here))}
      </Text>,
    )
  }
  // Projects finds as you type, so it has a line to type on, and every letter is the query's (?
  // included).
  if (focus === 'projects') {
    return withMarks(
      marks,
      <Text wrap="truncate-end">
        {chip('find')}
        <Text color={T.hi}>{'  ' + query}</Text>
        <Text inverse> </Text>
        {note(message, '  ⏎ focuses it · tab new conversation there · ↑↓ choose · esc back')}
      </Text>,
    )
  }
  // So does Archived's search, while it's being typed.
  if (focus === 'done' && here.search?.typing) {
    return withMarks(
      marks,
      <Text wrap="truncate-end">
        {chip('search')}
        <Text color={T.hi}>{'  ' + here.search.query}</Text>
        <Text inverse> </Text>
        {note(message, '  ⏎ keeps what it found · ↑↓ choose · esc drops it')}
      </Text>,
    )
  }
  if (focus === 'session') {
    return withMarks(
      marks,
      <Text wrap="truncate-end">
        {chip('claude')}
        {note(
          message,
          `keys go to Claude · ${hintText(hereKeys(here).hints)} · ctrl+] then ? all keys`,
        )}
      </Text>,
    )
  }
  // The focused panel's keys for what is selected, then the global ones it doesn't already name.
  // A routine's reports keep the keyboard to themselves, so none of the global keys apply.
  // A key the global ones already show (→) is left off the local hint.
  const bar = barKeys(here)
  const global = here.reports ? [] : GLOBAL.filter(([k]) => !bar.some(([l]) => l === k))
  const shown = new Set(global.flatMap(([k]) => k.split(' ')))
  const local = bar
    .map(([k, d]): Hint => [
      k
        .split(' ')
        .filter((t) => !shown.has(t))
        .join(' '),
      d,
    ])
    .filter(([k]) => k)
  return (
    <Box justifyContent="space-between">
      <Text wrap="truncate-end">
        {' '}
        {message ? (
          <Text color={T.waiting}>{message}</Text>
        ) : (
          <>
            {keys(local)}
            {local.length && global.length ? <Text color={T.faint}>{'│  '}</Text> : null}
            {keys(global)}
          </>
        )}
      </Text>
      <Box flexShrink={0}>
        <Text>
          {error ? <Text color={T.blocked}>{'  ' + error}</Text> : null}
          <Text color={T.text}>{'  ?'}</Text>
          <Text color={T.dim}> all keys</Text>
          {marks}
          <Text> </Text>
        </Text>
      </Box>
    </Box>
  )
}
