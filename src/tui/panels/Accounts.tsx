import { Text } from 'ink'
import { memo } from 'react'

import type { Window } from '../../claude.ts'
import { cell, isStale } from '../../format.ts'
import type { AccountState } from '../../model.ts'
import { T, tone } from '../theme.ts'
import { Rail, windowed } from './primitives.tsx'

// One line per account: its name, then the session and weekly limits side by side. Plan,
// resets and routes are in the detail panel, shown when the account is selected.

// Bar width for each limit, from the space left after the rail, the name column, two
// percentages and the gap between them.
const barWidth = (width: number, nameW: number) =>
  Math.max(3, Math.min(16, Math.floor((width - 4 - nameW - 11) / 2)))

// The accounts shown under the heading line, windowed around the selection. The mouse reads it
// too, to find the account under the pointer.
export const accountLines = (accounts: AccountState[], sel: number, height: number) =>
  windowed(accounts, sel, Math.max(1, height - 3))

export function AccountsHeader({ width, nameW }: { width: number; nameW: number }) {
  const barW = barWidth(width, nameW)
  return <Text color={T.dim}>{' ' + cell('', nameW) + cell('session', barW + 5) + 'week'}</Text>
}

export const AccountRow = memo(function AccountRow(props: {
  a: AccountState
  width: number
  nameW: number
  color: string
  selected: boolean
  // Under the pointer: a lighter background than the selection's.
  hovered: boolean
  focused: boolean
  // When the numbers were read, so render stays pure.
  now: number
}) {
  const { a, width, nameW, color, selected, hovered, focused, now } = props
  const on = selected && focused
  const bg = on ? T.sel : hovered ? T.hover : undefined
  const barW = barWidth(width, nameW)
  const limit = (x: Window | null | undefined) => {
    const stale = !x || isStale(x.resetsAt, now)
    const pct = stale ? 0 : x.pct
    const n = Math.max(0, Math.min(barW, Math.round((pct / 100) * barW)))
    return (
      <>
        <Text color={tone(pct)}>{'━'.repeat(n)}</Text>
        <Text color={T.line}>{'─'.repeat(barW - n)}</Text>
        <Text color={stale ? T.faint : pct >= 75 ? tone(pct) : T.text}>
          {cell(stale ? '–' : `${pct}%`, 5, 'right')}
        </Text>
      </>
    )
  }
  const u = a.usage
  const rest = a.authError ? (
    <Text color={T.blocked}>{a.authError}</Text>
  ) : !a.auth ? (
    <Text color={T.faint}>…</Text>
  ) : !a.auth.loggedIn ? (
    <Text>
      <Text color={T.waiting}>not signed in</Text>
      {on ? <Text color={T.dim}> · ⏎ signs in</Text> : null}
    </Text>
  ) : !u ? (
    <Text color={T.dim}>no usage · u fetches it</Text>
  ) : (
    <>
      {limit(u.fiveHour)}
      <Text> </Text>
      {limit(u.sevenDay)}
    </>
  )
  return (
    <Text wrap="truncate-end">
      <Rail on={on} bg={bg} />
      <Text backgroundColor={bg}>
        <Text bold color={color}>
          {cell(a.account.name, nameW)}
        </Text>
        {rest}
        {a.sessionError ? <Text color={T.blocked}> !</Text> : null}
      </Text>
    </Text>
  )
})
