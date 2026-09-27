import { Text } from 'ink'

import type { Config } from '../../config.ts'
import { tildify } from '../../paths.ts'
import { Frame } from '../panels/primitives.tsx'
import { T } from '../theme.ts'

const LINES = [
  'Hopper opens on Projects. Letters act on the panel you are in; esc goes back.',
  '',
  'anywhere       f find a project · t new conversation · p q v c jump to projects, the list, done,',
  '               accounts · n first thing waiting on you · tab next panel · R refresh · ? this · x quit',
  'projects       j/k move · ⏎ focus it (the list narrows to it) · z fold a folder',
  'the list       j/k move · ⏎ open it here · m mark done · i send esc to its conversation',
  '               w d r o u jump to waiting on you, drafts, running, routines, up next',
  'done           ⏎ open · m bring it back',
  'accounts       ⏎ sign in · a add · e prefixes it runs · 1 make it first · r rename · d remove · * make default',
  '',
  'a draft        ⏎ new line · arrows move, option+arrows by word, cmd+arrows to the ends',
  '               shift with any of those selects · esc, then: s start · p move · y copy · x throw away',
  '               · esc keep it · m model · e effort · r make it a routine',
  'a routine      ⏎ opens its prompt; esc, then: s run now · S schedule · P pause · m model · e effort',
  '               · p project · x remove · esc save. Each run is its own conversation and writes a',
  '               result; runs that need nothing go straight to done.',
  'a conversation every key goes to Claude, except esc, which comes back here and leaves it open.',
  '               ctrl+c interrupts Claude. Claude’s own double-esc rewind isn’t available inside Hopper.',
  '',
  'mouse          the wheel scrolls what is under it; a click focuses a panel. In a conversation,',
  '               drag to select and let go to copy. Elsewhere hold your terminal’s selection modifier.',
  'arrows         ← → move between columns · accounts: u asks Claude for fresh usage',
  '',
  'Ask Claude in a conversation to file items; it knows the project’s _open.md.',
]

export function HelpPane({
  config,
  width,
  height,
}: {
  config: Config
  width: number
  height: number
}) {
  return (
    <Frame title="KEYS" meta="any key closes" width={width} height={height} focused>
      {LINES.map((l, i) => (
        <Text key={i} color={T.text}>
          {l || ' '}
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
