import { stripVTControlCharacters } from 'node:util'

import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import type { Config } from '../src/config.ts'
import type { Item } from '../src/model.ts'
import type { Here } from '../src/tui/keymap.ts'
import { HelpPane, helpMaxScroll } from '../src/tui/panes/HelpPane.tsx'

const config = { path: '/c/config.toml', accountsPath: '/c/accounts.toml', home: '/h' } as Config
const here: Here = {
  focus: 'work',
  scope: null,
  embedOpen: false,
  summaryShown: true,
  untrusted: false,
  editing: null,
}
const plain = (s: string | undefined) => stripVTControlCharacters(s ?? '')
const draw = (h: Here, scroll: number, width = 100, height = 40) =>
  plain(
    render(
      <HelpPane config={config} here={h} scroll={scroll} width={width} height={height} />,
    ).lastFrame(),
  )

describe('the help screen', () => {
  it('lays sections out in columns, one key a line, and lights where you are', () => {
    const frame = draw(here, 0)
    expect(frame).toContain('ANYWHERE')
    expect(frame).toMatch(/│ ANYWHERE +A ROUTINE/)
    expect(frame).toMatch(/│ +p {2}projects: type to find one +/)
    expect(frame).toContain('THE LIST  you are here')
    const draft = { kind: 'draft' } as Item
    expect(draw({ ...here, item: draft }, 0, 100, 70)).toContain('A DRAFT  you are here')
  })
  it('scrolls when taller than the screen, and no further than its end', () => {
    expect(helpMaxScroll(100, 200)).toBe(0)
    const max = helpMaxScroll(60, 30)
    expect(max).toBeGreaterThan(0)
    expect(draw(here, 0, 60, 30)).toContain('j k scroll')
    expect(draw(here, 0, 60, 30)).toContain('ANYWHERE')
    expect(draw(here, 20, 60, 30)).not.toContain('ANYWHERE')
    expect(draw(here, max + 50, 60, 30)).toEqual(draw(here, max, 60, 30))
    expect(draw(here, max, 60, 30)).toContain('MOUSE')
  })
})
