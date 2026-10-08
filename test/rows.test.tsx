import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import type { Item } from '../src/model.ts'
import { shortName } from '../src/tui/panels/ItemRows.tsx'
import { WorkRows } from '../src/tui/panes/WorkRows.tsx'

const item = (name: string, key = 'pm/tern') => ({ name, key, cwd: '/p' }) as Item

describe('shortName', () => {
  it('leaves off the project when the name starts with it, since it has its own column', () => {
    expect(shortName(item('pm/tern · Titles are cut off'))).toBe('Titles are cut off')
  })
  it('keeps names that start with another project, or are only the project', () => {
    expect(shortName(item('pm/meta · Titles are cut off'))).toBe('pm/meta · Titles are cut off')
    expect(shortName(item('pm/tern · '))).toBe('pm/tern · ')
    expect(shortName(item('Draft the spring newsletter'))).toBe('Draft the spring newsletter')
  })
})

describe('the list columns', () => {
  const rows = [
    { name: 'Sort the inbox', key: 'pm/meta', state: 'done', model: 'opus[1m]' },
    { name: 'Fix the margins', key: 'pm/underlay', state: 'done' },
    {
      name: 'morning-brief',
      key: 'pm/meta',
      kind: 'routine',
      state: 'scheduled',
      model: 'sonnet',
      nextAt: Date.now() + 3 * 86_400_000,
    },
    { name: 'inbox-sweep', key: 'meta/inbox', kind: 'routine', state: 'paused', model: 'haiku' },
  ].map((r, i) => ({ account: 'pm', sessionId: 's' + i, cwd: '/p', activeAt: 0, ...r }) as Item)
  const lines = (width: number) =>
    (
      render(
        <WorkRows
          items={rows}
          sel={-1}
          hover={null}
          focused={false}
          width={width}
          height={20}
          color={() => 'blue'}
        />,
      ).lastFrame() ?? ''
    )
      .split('\n')
      .filter((l) => /pm\/|meta\//.test(l))

  it('puts project, account, model and age in the same place on every row', () => {
    const got = lines(80)
    expect(got).toHaveLength(4)
    const at = (word: string) => got.map((l) => l.indexOf(word))
    expect(new Set(got.map((l) => l.search(/(pm|meta)\//))).size).toBe(1)
    expect(new Set(got.map((l) => l.lastIndexOf(' pm ')).filter((x) => x >= 0)).size).toBe(1)
    expect(at('opus[1m]')[0]).toBe(at('sonnet')[2])
    expect(at('sonnet')[2]).toBe(at('haiku')[3])
    // The rows end together, at the panel's edge: no column kept open at the end for routines.
    expect(new Set(got.map((l) => l.trimEnd().length)).size).toBe(1)
  })

  it("gives a routine's next run a column between its name and its project", () => {
    const [, , scheduled] = lines(80)
    expect(scheduled).toMatch(/morning-brief +in \dd pm\/meta/)
  })
})
