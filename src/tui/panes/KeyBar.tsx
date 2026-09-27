import { Box, Text } from 'ink'

import { FORM_PROMPT, type Editing, type Find, type Focus, type Form } from '../state.ts'
import { T } from '../theme.ts'

// A mode that changes what keys do says so at the left of the key bar.
const chip = (label: string) => (
  <Text backgroundColor={T.focus} color={T.onFill} bold>{` ${label} `}</Text>
)

const keys = (list: [string, string][]) =>
  list.map(([k, d], i) => (
    <Text key={i}>
      <Text color={T.text}>{k}</Text>
      <Text color={T.dim}>{` ${d}    `}</Text>
    </Text>
  ))

const note = (message: string | null, hint: string) =>
  message ? (
    <Text color={T.waiting}>{'  ' + message}</Text>
  ) : (
    <Text color={T.dim}>{'  ' + hint}</Text>
  )

function FormBar({ form }: { form: Form }) {
  const removing = form.kind === 'remove' || form.kind === 'routine-remove'
  const label = removing
    ? 'remove'
    : form.kind === 'add-name' || form.kind === 'add-dir'
      ? 'add account'
      : form.kind === 'routine-name'
        ? 'new routine'
        : form.name
  return (
    <Text wrap="truncate-end">
      {chip(label)}
      {removing ? (
        <Text color={T.text}>
          {form.kind === 'remove'
            ? `  Remove ${form.name} from Hopper? Its login and sessions stay.  `
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

function editingHint(e: Editing): string {
  if (e.stage === 'write') {
    return 'type · ⏎ new line · arrows move (option: by word) · shift selects · esc when you want to decide'
  }
  if (e.stage === 'pick') return 'type to filter · ↑↓ choose · tab or ⏎ picks · esc back'
  if (e.routine) {
    return `s run now · S schedule (${e.routine.schedule || 'none'}) · P ${e.routine.enabled ? 'pause' : 'resume'} · m model (${e.model ?? 'default'}) · e effort · p project · x remove · esc save · any other key edits the prompt`
  }
  return `s start it · r make it a routine · m model (${e.model ?? 'default'}) · e effort (${e.effort ?? 'default'}) · p move · y copy · x throw away · esc keep as draft · any other key keeps writing`
}

// The bottom line: what the keys do right now, or the last message.
export function KeyBar(props: {
  form: Form | null
  editing: Editing | null
  find: Find | null
  focus: Focus
  message: string | null
  error: string | null
}) {
  const { form, editing, find, focus, message, error } = props
  if (form) return <FormBar form={form} />
  if (editing) {
    return (
      <Text wrap="truncate-end">
        {chip(editing.routine ? 'routine' : 'draft')}
        <Text color={T.text}>{` ${editing.project}`}</Text>
        {note(message, editingHint(editing))}
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
        {note(message, 'keys go to Claude · esc comes back to Hopper · ctrl+c interrupts Claude')}
      </Text>
    )
  }
  // Only keys that work anywhere: the panel's own are on its title and in the right panel.
  // The focused panel is named at the right, so it is known even without colour.
  return (
    <Box justifyContent="space-between">
      <Text wrap="truncate-end">
        {' '}
        {message ? (
          <Text color={T.waiting}>{message}</Text>
        ) : (
          keys([
            ['f', 'find'],
            ['t', 'new conversation'],
            ['n', 'next waiting'],
            ['R', 'refresh'],
            ['?', 'all keys'],
            ['esc', 'back'],
            ['x', 'quit'],
          ])
        )}
      </Text>
      <Box flexShrink={0}>
        <Text>
          {error ? <Text color={T.blocked}>{'  ' + error}</Text> : null}
          <Text color={T.faint}>{'  ' + (focus === 'work' ? 'conversations' : focus) + ' '}</Text>
        </Text>
      </Box>
    </Box>
  )
}
