import { Text } from 'ink'
import { memo } from 'react'

import type { Window } from '../../claude.ts'
import { cell, isStale, resetShort } from '../../format.ts'
import type { AccountState } from '../../model.ts'
import { T, tone } from '../theme.ts'
import { Rail, windowed } from './primitives.tsx'

// Each account: its name, then the session and weekly limits side by side, with when each one
// resets on a second line when there's room. A tick on each bar marks how far through its window
// we are, so a fill short of it has room to spare. Plan and routes are in the detail panel.

// Bar width for each limit, from the space left after the rail, the name column, two
// percentages and the gap between them.
const barWidth = (width: number, nameW: number) =>
  Math.max(3, Math.min(16, Math.floor((width - 4 - nameW - 11) / 2)))

// How long each limit's window is, to place the pace tick.
const WINDOW_MS = { session: 5 * 3600_000, week: 7 * 24 * 3600_000 }

// Where on a bar of `width` cells the window's elapsed time falls, or null when the reset time
// isn't known or has passed.
export function paceAt(resetsAt: string | null, windowMs: number, width: number, now: number) {
  const t = resetsAt ? Date.parse(resetsAt) : NaN
  if (Number.isNaN(t) || t <= now) return null
  const elapsed = 1 - Math.min(1, (t - now) / windowMs)
  return Math.min(width - 1, Math.floor(elapsed * width))
}

// The accounts shown under the heading line, windowed around the selection, and how many lines
// each takes: two when they all fit, else one. The mouse reads it too, to find the account under
// the pointer.
export function accountLines(accounts: AccountState[], sel: number, height: number) {
  const room = Math.max(1, height - 3)
  const perAccount = accounts.length * 2 <= room ? 2 : 1
  return { ...windowed(accounts, sel, Math.floor(room / perAccount)), perAccount }
}

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
  // Whether the resets line shows under the bars.
  resets: boolean
}) {
  const { a, width, nameW, color, selected, hovered, focused, now, resets } = props
  const on = selected && focused
  const bg = on ? T.sel : hovered ? T.hover : undefined
  const barW = barWidth(width, nameW)
  const limit = (x: Window | null | undefined, windowMs: number) => {
    const stale = !x || isStale(x.resetsAt, now)
    const pct = stale ? 0 : x.pct
    const n = Math.max(0, Math.min(barW, Math.round((pct / 100) * barW)))
    const tick = stale ? null : paceAt(x.resetsAt, windowMs, barW, now)
    // The tick sits on the fill once usage has passed it, on the track while it hasn't.
    const fill = (from: number, to: number) => (
      <Text color={tone(pct)}>{'━'.repeat(Math.max(0, to - from))}</Text>
    )
    const track = (from: number, to: number) => (
      <Text color={T.line}>{'─'.repeat(Math.max(0, to - from))}</Text>
    )
    return (
      <>
        {tick === null ? (
          <>
            {fill(0, n)}
            {track(n, barW)}
          </>
        ) : tick < n ? (
          <>
            {fill(0, tick)}
            <Text color={tone(pct)}>╋</Text>
            {fill(tick + 1, n)}
            {track(n, barW)}
          </>
        ) : (
          <>
            {fill(0, n)}
            {track(n, tick)}
            <Text color={T.dim}>┆</Text>
            {track(tick + 1, barW)}
          </>
        )}
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
      {limit(u.fiveHour, WINDOW_MS.session)}
      <Text> </Text>
      {limit(u.sevenDay, WINDOW_MS.week)}
    </>
  )
  // Under each bar, when it resets. Blank for a limit with no reset time.
  const resetOf = (x: Window | null | undefined) => {
    const r = x ? resetShort(x.resetsAt, now) : ''
    return r ? `↻ ${r.replace(/^in /, '')}` : ''
  }
  const second =
    a.auth?.loggedIn && u ? cell(resetOf(u.fiveHour), barW + 5) + resetOf(u.sevenDay) : ''
  return (
    <>
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
      {resets ? (
        <Text wrap="truncate-end">
          <Rail on={on} bg={bg} />
          <Text backgroundColor={bg} color={T.dim}>
            {cell('', nameW) + second}
          </Text>
        </Text>
      ) : null}
    </>
  )
})
