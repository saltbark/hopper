import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'

import { Frame } from '../src/tui/panels/primitives.tsx'
import { dimLine, setDim } from '../src/tui/theme.ts'

const E = '\u001b['
const coloured = `${E}38;2;200;100;50mhi${E}39m plain`

describe('dimLine', () => {
  it('darkens every truecolor foreground, and leaves backgrounds and plain text alone', () => {
    expect(dimLine(`${coloured} ${E}48;2;26;34;39m${E}38;2;10;20;30mx${E}49m`)).toBe(
      `${E}38;2;124;62;31mhi${E}39m plain ${E}48;2;26;34;39m${E}38;2;6;12;19mx${E}49m`,
    )
    expect(dimLine('no colour at all')).toBe('no colour at all')
  })
  it('leaves a row on the selection background bright', () => {
    const held = `${E}48;2;36;48;57m${coloured}${E}49m`
    expect(dimLine(held)).toBe(held)
  })
  it('draws the line faint where there are only 256 colours', () => {
    expect(dimLine(`${E}38;5;110mhi${E}39m`)).toBe(`${E}2m${E}38;5;110mhi${E}39m${E}22m`)
  })
})

describe('setDim', () => {
  afterEach(() => setDim(38))
  it('darkens by the amount set, forgetting lines darkened by the last one', () => {
    expect(dimLine(coloured)).toContain('38;2;124;62;31m')
    setDim(50)
    expect(dimLine(coloured)).toContain('38;2;100;50;25m')
    setDim(80)
    expect(dimLine(coloured)).toContain('38;2;40;20;10m')
  })
  it('leaves every line alone at 0, faint ones included', () => {
    setDim(0)
    expect(dimLine(coloured)).toBe(coloured)
    expect(dimLine(`${E}38;5;110mhi${E}39m`)).toBe(`${E}38;5;110mhi${E}39m`)
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
