import { Box, Text } from 'ink'

import { barKeys, hereKeys, type Hint, type Here } from '../keymap.ts'
import { FORM_PROMPT, type Editing, type Find, type Form } from '../state.ts'
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
// end; ? sits at the right with the panel's name, so it never does.
const GLOBAL: Hint[] = [
  ['f', 'find'],
  ['t', 'new conversation'],
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
    form.kind === 'remove' || form.kind === 'routine-remove' || form.kind === 'setting-remove'
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
              : `  Remove the routine ${form.name}? Its schedule stops; past runs stay.  `}
          <Text bold color={T.hi}>
            y
          </Text>
          <Text color={T.dim}> remove · any other key keeps it</Text>
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
  const hint = hintText(hereKeys(here).hints)
  return e.stage === 'write'
    ? `type · ${hint}`
    : `${hint} · any other key ${e.routine ? 'edits the prompt' : 'keeps writing'}`
}

// The bottom line: what the keys do right now, or the last message.
export function KeyBar(props: {
  form: Form | null
  editing: Editing | null
  find: Find | null
  here: Here
  message: string | null
  error: string | null
}) {
  const { form, editing, find, here, message, error } = props
  const { focus } = here
  if (form) return <FormBar form={form} />
  if (editing) {
    return (
      <Text wrap="truncate-end">
        {chip(editing.routine ? 'routine' : 'draft')}
        <Text color={T.text}>{` ${editing.project}`}</Text>
        {note(message, editingHint(editing, here))}
      </Text>
    )
  }
  if (here.setting !== undefined) {
    return (
      <Text wrap="truncate-end">
        {chip('settings')}{' '}
        {message ? <Text color={T.waiting}>{' ' + message}</Text> : keys(barKeys(here))}
      </Text>
    )
  }
  if (find) {
    return (
      <Text wrap="truncate-end">
        {chip('find')}
        <Text color={T.hi}>{'  ' + find.query}</Text>
        <Text inverse> </Text>
        <Text color={T.dim}>{'  ⏎ focuses it · ↑↓ choose · esc cancel'}</Text>
      </Text>
    )
  }
  if (focus === 'session') {
    return (
      <Text wrap="truncate-end">
        {chip('claude')}
        {note(
          message,
          `keys go to Claude · ${hintText(hereKeys(here).hints)} · esc then ? all keys`,
        )}
      </Text>
    )
  }
  // The focused panel's keys for what is selected, then the global ones it doesn't already name.
  // The panel is named at the right, so it is known even without colour.
  const local = barKeys(here)
  return (
    <Box justifyContent="space-between">
      <Text wrap="truncate-end">
        {' '}
        {message ? (
          <Text color={T.waiting}>{message}</Text>
        ) : (
          <>
            {keys(local)}
            {local.length ? <Text color={T.faint}>{'│  '}</Text> : null}
            {keys(GLOBAL.filter(([k]) => !local.some(([l]) => l === k)))}
          </>
        )}
      </Text>
      <Box flexShrink={0}>
        <Text>
          {error ? <Text color={T.blocked}>{'  ' + error}</Text> : null}
          <Text color={T.text}>{'  ?'}</Text>
          <Text color={T.dim}> all keys</Text>
          <Text color={T.faint}>{'  ' + (focus === 'work' ? 'conversations' : focus) + ' '}</Text>
        </Text>
      </Box>
    </Box>
  )
}
