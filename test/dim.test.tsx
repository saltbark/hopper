import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { Frame } from '../src/tui/panels/primitives.tsx'
import { dimLine } from '../src/tui/theme.ts'

const E = '\u001b['
const coloured = `${E}38;2;200;100;50mhi${E}39m plain`

describe('dimLine', () => {
  it('darkens every truecolor foreground, and leaves backgrounds and plain text alone', () => {
    expect(dimLine(`${coloured} ${E}48;2;36;48;57m${E}38;2;10;20;30mx${E}49m`)).toBe(
      `${E}38;2;124;62;31mhi${E}39m plain ${E}48;2;36;48;57m${E}38;2;6;12;19mx${E}49m`,
    )
    expect(dimLine('no colour at all')).toBe('no colour at all')
  })
  it('draws the line faint where there are only 256 colours', () => {
    expect(dimLine(`${E}38;5;110mhi${E}39m`)).toBe(`${E}2m${E}38;5;110mhi${E}39m${E}22m`)
  })
})

describe('Frame', () => {
  const draw = (dimmed: boolean) =>
    render(
      <Frame title="LIST" width={20} height={3} dimmed={dimmed}>
        <Text>{coloured}</Text>
      </Frame>,
    ).lastFrame() ?? ''
  it('draws a panel without the keys a step darker, inside and out', () => {
    expect(draw(false)).toContain('38;2;200;100;50m')
    expect(draw(true)).toContain('38;2;124;62;31m')
    expect(draw(true)).not.toContain('38;2;200;100;50m')
  })
})
