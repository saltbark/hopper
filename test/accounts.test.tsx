import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import type { AccountState } from '../src/model.ts'
import { AccountRow, accountLines, paceAt } from '../src/tui/panels/Accounts.tsx'

const now = Date.parse('2026-09-28T12:00:00Z')
const HOUR = 3_600_000

const account = (name: string, over: Partial<AccountState> = {}): AccountState => ({
  account: { name, label: name, configDir: null },
  auth: { loggedIn: true },
  authError: null,
  usage: {
    // Two of five hours gone, and five of seven days.
    fiveHour: { pct: 7, resetsAt: new Date(now + 3 * HOUR).toISOString() },
    sevenDay: { pct: 90, resetsAt: new Date(now + 2 * 24 * HOUR).toISOString() },
    fetchedAt: now,
  },
  sessionError: null,
  sessions: [],
  sessionsAt: null,
  counts: { queue: 0, needs: 0, done: 0, live: 0 },
  ...over,
})

describe('paceAt', () => {
  it('places the tick at how far through the window we are', () => {
    expect(paceAt(new Date(now + 3 * HOUR).toISOString(), 5 * HOUR, 10, now)).toBe(4)
    expect(paceAt(new Date(now + 5 * HOUR).toISOString(), 5 * HOUR, 10, now)).toBe(0)
    expect(paceAt(new Date(now + 1).toISOString(), 5 * HOUR, 10, now)).toBe(9)
  })
  it('has no tick without a reset time, or once it has passed', () => {
    expect(paceAt(null, 5 * HOUR, 10, now)).toBeNull()
    expect(paceAt(new Date(now - 1).toISOString(), 5 * HOUR, 10, now)).toBeNull()
  })
})

describe('accountLines', () => {
  it('gives each account two lines when they all fit, else one', () => {
    const three = ['kf', 'sb', 'xx'].map((n) => account(n))
    expect(accountLines(three, 0, 9).perAccount).toBe(2)
    expect(accountLines(three, 0, 9).slice).toHaveLength(3)
    expect(accountLines(three, 2, 8).perAccount).toBe(1)
    expect(accountLines(three, 2, 8).slice).toHaveLength(3)
  })
})

describe('AccountRow', () => {
  const row = (resets: boolean) =>
    render(
      <AccountRow
        a={account('kf')}
        width={60}
        nameW={4}
        color="white"
        selected={false}
        hovered={false}
        focused={false}
        now={now}
        resets={resets}
      />,
    ).lastFrame()!

  it('draws the pace tick on the track when usage is behind it, on the fill when past it', () => {
    const [bars] = row(false).split('\n')
    const [session, week] = bars!.split(/\s+\d+%\s*/)
    expect(session).toContain('┆')
    expect(week).toContain('╋')
  })

  it('shows when each limit resets on a second line', () => {
    const lines = row(true).split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('↻ 3h 00m')
    expect(lines[1]).toMatch(/↻ \w{3} \d\d:\d\d/)
  })
})
