import { describe, expect, it, vi } from 'vitest'

import { EmbeddedSession } from '../src/tui/embed.ts'
import { parseMouse } from '../src/tui/mouse.ts'
import { fakeClaude } from './helpers.ts'

describe('parseMouse', () => {
  it('reads wheel and click events as Ink hands them over, several at once', () => {
    expect(parseMouse('[<64;100;5M')).toEqual([{ kind: 'wheel-up', x: 100, y: 5 }])
    expect(parseMouse('[<65;3;4M[<65;3;5M')).toEqual([
      { kind: 'wheel-down', x: 3, y: 4 },
      { kind: 'wheel-down', x: 3, y: 5 },
    ])
    expect(parseMouse('[<0;10;2M')).toEqual([{ kind: 'press', x: 10, y: 2 }])
    expect(parseMouse('[<0;10;2m')).toEqual([{ kind: 'release', x: 10, y: 2 }])
    expect(parseMouse('[<32;11;2M')).toEqual([{ kind: 'drag', x: 11, y: 2 }])
    expect(parseMouse('[<68;1;1M')?.[0]?.kind).toBe('wheel-up') // with shift held
    expect(parseMouse('hello')).toBeNull()
  })
})

describe('EmbeddedSession.wheel', () => {
  const fake = fakeClaude
  const account = { name: 'kf', label: 'kf', configDir: null }
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 160 && !ok(); i++) await new Promise((r) => setTimeout(r, 50))
  }

  it('sends PgUp/PgDn when Claude has not asked for the mouse, and real wheel events when it has', async () => {
    process.env['HOPPER_CLAUDE'] = await fake('printf "ready\\n"; sleep 3')
    const plain = new EmbeddedSession(account, 'a', 'x', 40, 10, {
      onChange: () => {},
      onLeave: () => {},
      onStepBack: () => {},
    })
    plain.start()
    await until(() =>
      plain
        .screen()[0]!
        .map((s) => s.text)
        .join('')
        .includes('ready'),
    )
    const sent = vi.spyOn(plain, 'send')
    plain.wheel(true, 5, 5)
    expect(sent).toHaveBeenLastCalledWith('\x1b[5~')
    plain.close()

    // A program that turns on mouse reporting, as Claude's scrollback view does.
    process.env['HOPPER_CLAUDE'] = await fake(
      'printf "\\033[?1000h\\033[?1006hmouse on\\n"; sleep 3',
    )
    const mousy = new EmbeddedSession(account, 'a', 'x', 40, 10, {
      onChange: () => {},
      onLeave: () => {},
      onStepBack: () => {},
    })
    mousy.start()
    await until(() =>
      mousy
        .screen()[0]!
        .map((s) => s.text)
        .join('')
        .includes('mouse on'),
    )
    const sent2 = vi.spyOn(mousy, 'send')
    mousy.wheel(false, 7, 3)
    expect(sent2).toHaveBeenLastCalledWith('\x1b[<65;7;3M')
    mousy.close()
    delete process.env['HOPPER_CLAUDE']
  }, 30_000)
})
