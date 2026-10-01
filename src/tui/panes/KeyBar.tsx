import { Box, Text } from 'ink'
import type { ReactNode } from 'react'

import { barKeys, hereKeys, type Hint, type Here } from '../keymap.ts'
import { FORM_PROMPT, type Editing, type Form } from '../state.ts'
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
// end; ? sits at the right with the panel's name, so it never does. → and ← come first: in and out
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
            y
          </Text>
          <Text color={T.dim}>
            {form.kind === 'draft-remove' ? ' throw away' : ' remove'} · any other key keeps it
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

// While z is holding the Mac awake, the line ends in a coffee cup, whatever is on screen. It is
// the emoji (U+FE0F), not the text glyph, which terminals draw small and a cell narrower than Ink
// counts it. Last on the line, so a terminal that still draws it narrow moves nothing else.
const CUP = '\u2615\uFE0F'

// A line with nothing of its own at the right gets the cup there.
const withCup = (awake: boolean, line: ReactNode) =>
  awake ? (
    <Box justifyContent="space-between">
      <Box flexShrink={1} minWidth={0}>
        {line}
      </Box>
      <Box flexShrink={0}>
        <Text>{'  ' + CUP}</Text>
      </Box>
    </Box>
  ) : (
    line
  )

// The bottom line: what the keys do right now, or the last message.
export function KeyBar(props: BarProps & { awake: boolean }) {
  const { form, editing, query, here, message, error, awake } = props
  const { focus } = here
  // The panel's name at the right end, then the cup.
  const named = (where: string) => (
    <Text color={T.faint}>{'  ' + where + (awake ? '  ' + CUP : ' ')}</Text>
  )
  if (form) return withCup(awake, <FormBar form={form} />)
  if (editing) {
    return withCup(
      awake,
      <Text wrap="truncate-end">
        {chip(editing.routine ? 'routine' : 'draft')}
        <Text color={T.text}>{` ${editing.project}`}</Text>
        {note(message, editingHint(editing, here))}
      </Text>,
    )
  }
  if (here.setting !== undefined) {
    return withCup(
      awake,
      <Text wrap="truncate-end">
        {chip('settings')}{' '}
        {message ? <Text color={T.waiting}>{' ' + message}</Text> : keys(barKeys(here))}
      </Text>,
    )
  }
  // Projects finds as you type, so it has a line to type on, and every letter is the query's (?
  // included). The panel is named at the right, as on the board.
  if (focus === 'projects') {
    return (
      <Box justifyContent="space-between">
        <Text wrap="truncate-end">
          {chip('find')}
          <Text color={T.hi}>{'  ' + query}</Text>
          <Text inverse> </Text>
          {note(message, '  ⏎ focuses it · tab new conversation there · ↑↓ choose · esc back')}
        </Text>
        <Box flexShrink={0}>{named('projects')}</Box>
      </Box>
    )
  }
  if (focus === 'session') {
    return withCup(
      awake,
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
  // The panel is named at the right, so it is known even without colour.
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
  const where = here.reports ? hereKeys(here).label : focus === 'work' ? 'conversations' : focus
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
          {named(where)}
        </Text>
      </Box>
    </Box>
  )
}
