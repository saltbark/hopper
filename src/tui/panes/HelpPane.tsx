import { Box, Text } from 'ink'

import type { Config } from '../../config.ts'
import { tildify } from '../../paths.ts'
import {
  ANYWHERE,
  CONVERSATION_KEYS,
  draftKeys,
  hereKeys,
  PANEL_KEYS,
  routineKeys,
  SETTINGS_KEYS,
  WRITING_KEYS,
  type Here,
  type Hint,
} from '../keymap.ts'
import { Frame } from '../panels/primitives.tsx'
import { T } from '../theme.ts'

const LABEL_W = 18

function Section({ label, hints, hi }: { label: string; hints: Hint[]; hi?: boolean }) {
  return (
    <Box flexDirection="row">
      <Box width={LABEL_W} flexShrink={0}>
        <Text color={hi ? T.hi : T.dim} bold={!!hi}>
          {label}
        </Text>
      </Box>
      <Text color={T.text}>
        {hints.map(([k, d], i) => (
          <Text key={i}>
            {i ? <Text color={T.faint}>{' · '}</Text> : null}
            <Text bold={!!hi}>{k}</Text>
            <Text color={T.dim}>{' ' + d}</Text>
          </Text>
        ))}
      </Text>
    </Box>
  )
}

const NOTES = [
  'Letters act on the focused panel; esc goes back.',
  'Mouse: the wheel scrolls what is under it; a click focuses a panel. In a conversation, drag to',
  'select and let go to copy; elsewhere hold your terminal’s selection modifier.',
  'In a conversation esc is Claude’s (its menus, its rewind); ← at its empty prompt, or ctrl+], steps back.',
  'Ask Claude in a conversation to file items; it knows the project’s _open.md.',
]

// Every key: first the ones for where you were when you pressed ?, then all of them.
export function HelpPane({
  config,
  here,
  width,
  height,
}: {
  config: Config
  here: Here
  width: number
  height: number
}) {
  const now = hereKeys(here)
  return (
    <Frame title="KEYS" meta="any key closes" width={width} height={height} focused>
      <Section label={`here · ${now.label}`} hints={now.hints} hi />
      <Text> </Text>
      <Section label="anywhere" hints={ANYWHERE} />
      {PANEL_KEYS.map(([label, hints]) => (
        <Section key={label} label={label} hints={hints} />
      ))}
      <Section label="writing a draft" hints={WRITING_KEYS} />
      <Section label="then" hints={draftKeys({})} />
      <Section
        label="a routine"
        hints={[['⏎', 'opens its prompt, then esc for'], ...routineKeys({})]}
      />
      <Section label="a conversation" hints={CONVERSATION_KEYS} />
      <Section label="settings (s)" hints={SETTINGS_KEYS} />
      <Text> </Text>
      {NOTES.map((l, i) => (
        <Text key={i} color={T.dim}>
          {l}
        </Text>
      ))}
      <Text> </Text>
      <Text color={T.dim}>
        Config: {tildify(config.path)} · accounts: {tildify(config.accountsPath)} · home:{' '}
        {tildify(config.home)}
      </Text>
    </Frame>
  )
}
