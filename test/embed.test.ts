import { describe, expect, it } from 'vitest'

import { EmbeddedSession, keyToBytes, paletteHex } from '../src/tui/embed.ts'
import { fakeClaude } from './helpers.ts'

const key = (over: Record<string, boolean> = {}) =>
  ({
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...over,
  }) as Parameters<typeof keyToBytes>[1]

describe('keyToBytes', () => {
  it('sends what a terminal would', () => {
    expect(keyToBytes('a', key())).toBe('a')
    expect(keyToBytes('', key({ return: true }))).toBe('\r')
    expect(keyToBytes('', key({ return: true, shift: true }))).toBe('\x1b\r')
    expect(keyToBytes('', key({ return: true, meta: true }))).toBe('\x1b\r')
    expect(keyToBytes('', key({ escape: true }))).toBe('\x1b')
    expect(keyToBytes('', key({ delete: true }))).toBe('\x7f')
    expect(keyToBytes('', key({ leftArrow: true }))).toBe('\x1b[D')
    expect(keyToBytes('', key({ tab: true, shift: true }))).toBe('\x1b[Z')
    expect(keyToBytes('c', key({ ctrl: true }))).toBe('\x03')
    expect(keyToBytes('b', key({ meta: true }))).toBe('\x1bb')
  })
})

describe('paletteHex', () => {
  it('covers the basic colours, the cube and the greys', () => {
    expect(paletteHex(1)).toBe('#cd0000')
    expect(paletteHex(16)).toBe('#000000')
    expect(paletteHex(231)).toBe('#ffffff')
    expect(paletteHex(232)).toBe('#080808')
  })
})

describe('EmbeddedSession', () => {
  const fake = fakeClaude
  const account = { name: 'kf', label: 'kf', configDir: null }

  it('shows what the session draws, with colour, and passes keys through', async () => {
    process.env['HOPPER_CLAUDE'] = await fake(
      'printf "\\033[32mgreen\\033[0m plain\\n"; read -r line; printf "got %s\\n" "$line"; sleep 2',
    )
    let changes = 0
    const s = new EmbeddedSession(account, 'abc', 'test', 40, 6, {
      onChange: () => changes++,
      onLeave: () => {},
    })
    s.start()
    const text = () =>
      s
        .screen()
        .map((r) => r.map((x) => x.text).join(''))
        .join('\n')
    for (let i = 0; i < 160 && !text().includes('green'); i++)
      await new Promise((r) => setTimeout(r, 50))
    await new Promise((r) => setTimeout(r, 200))
    const first = s.screen()[0]!
    expect(first[0]).toMatchObject({ text: 'green', fg: '#cd0000'.replace('cd0000', '00cd00') })
    expect(first.map((x) => x.text).join('')).toMatch(/^green plain/)
    s.send('hi\r')
    await new Promise((r) => setTimeout(r, 500))
    expect(
      s
        .screen()
        .map((r) => r.map((x) => x.text).join(''))
        .join('\n'),
    ).toContain('got hi')
    expect(changes).toBeGreaterThan(0)
    s.close()
    delete process.env['HOPPER_CLAUDE']
  }, 30_000)

  it('knows where the cursor is, and when the program hides it', async () => {
    process.env['HOPPER_CLAUDE'] = await fake(
      'printf "one\\ntwo"; sleep 0.5; printf "\\033[?25l"; sleep 0.5; printf "\\033[?25h"; sleep 2',
    )
    const s = new EmbeddedSession(account, 'abc', 'test', 40, 6, { onLeave: () => {} })
    s.start()
    for (let i = 0; i < 160 && !s.cursor()?.col; i++) await new Promise((r) => setTimeout(r, 20))
    expect(s.cursor()).toEqual({ col: 3, row: 1 })
    for (let i = 0; i < 160 && s.cursor(); i++) await new Promise((r) => setTimeout(r, 20))
    expect(s.cursor()).toBeNull()
    for (let i = 0; i < 160 && !s.cursor(); i++) await new Promise((r) => setTimeout(r, 20))
    expect(s.cursor()).toEqual({ col: 3, row: 1 })
    s.close()
    delete process.env['HOPPER_CLAUDE']
  }, 30_000)

  it('passes on what the program copies with OSC 52', async () => {
    const b64 = Buffer.from('copied text').toString('base64')
    process.env['HOPPER_CLAUDE'] = await fake(`printf "\\033]52;c;${b64}\\007"; sleep 2`)
    const copied: string[] = []
    const s = new EmbeddedSession(account, 'abc', 'test', 40, 6, {
      onChange: () => {},
      onLeave: () => {},
      onCopy: (t) => copied.push(t),
    })
    s.start()
    for (let i = 0; i < 160 && !copied.length; i++) await new Promise((r) => setTimeout(r, 50))
    expect(copied).toEqual(['copied text'])
    s.close()
    delete process.env['HOPPER_CLAUDE']
  }, 30_000)

  it("treats Claude's agents screen as leaving, and so does the session ending", async () => {
    process.env['HOPPER_CLAUDE'] = await fake(
      'printf "Needs input\\n  enter to return · space to reply · ctrl+x to delete\\n"; sleep 5',
    )
    let left = 0
    const s = new EmbeddedSession(account, 'abc', 'test', 60, 6, {
      onChange: () => {},
      onLeave: () => left++,
    })
    s.start()
    for (let i = 0; i < 160 && !left; i++) await new Promise((r) => setTimeout(r, 50))
    expect(left).toBe(1)
    process.env['HOPPER_CLAUDE'] = await fake('printf "bye\\n"')
    let ended = 0
    const t = new EmbeddedSession(account, 'abc', 'test', 60, 6, {
      onChange: () => {},
      onLeave: () => ended++,
    })
    t.start()
    for (let i = 0; i < 160 && !ended; i++) await new Promise((r) => setTimeout(r, 50))
    expect(ended).toBe(1)
    delete process.env['HOPPER_CLAUDE']
  }, 30_000)
})
