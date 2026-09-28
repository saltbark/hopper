import { readFileSync } from 'node:fs'

import xterm from '@xterm/headless'
import { describe, expect, it } from 'vitest'

import { admit, atEmptyPrompt, EmbeddedSession, keyToBytes, paletteHex } from '../src/tui/embed.ts'
import { T } from '../src/tui/theme.ts'
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
    expect(paletteHex(2)).toBe(T.running)
    expect(paletteHex(16)).toBe('#000000')
    expect(paletteHex(231)).toBe('#ffffff')
    expect(paletteHex(232)).toBe('#080808')
  })
})

// Screens captured from Claude Code 2.1.283 (`claude`, and `claude attach` on a finished
// session), trimmed to the rows round the prompt: text, dim cells, and where the cursor was.
type Shot = { about: string; cursor: [number, number]; text: string[]; dim: string[] }
const shots = JSON.parse(
  readFileSync(new URL('./fixtures/claude-prompts.json', import.meta.url), 'utf8'),
) as Record<string, Shot>

const draw = async (shot: Shot) => {
  const term = new xterm.Terminal({ cols: 70, rows: shot.text.length, allowProposedApi: true })
  const rows = shot.text.map((line, y) =>
    [...line].map((ch, x) => (shot.dim[y]?.[x] === 'd' ? `\x1b[2m${ch}\x1b[22m` : ch)).join(''),
  )
  const [x, y] = shot.cursor
  await new Promise<void>((r) => term.write(rows.join('\r\n') + `\x1b[${y + 1};${x + 1}H`, r))
  return term
}

describe('atEmptyPrompt', () => {
  const empty = ['empty', 'attach']
  for (const [name, shot] of Object.entries(shots)) {
    it(`${empty.includes(name) ? 'is' : 'is not'} the empty prompt: ${shot.about}`, async () => {
      const term = await draw(shot)
      expect(atEmptyPrompt(term.buffer.active)).toBe(empty.includes(name))
      term.dispose()
    })
  }
})

describe('admit', () => {
  const s = (id: string) => ({ id })
  it('puts the one gone into first, and closes what no longer fits', () => {
    const [a, b, c] = [s('a'), s('b'), s('c')]
    expect(admit([a, b], c, 2)).toEqual({ open: [c, a], dropped: [b] })
    // Going back into one already open only moves it up.
    const back = admit([a, b, c], c, 3)
    expect(back.open.map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(back.dropped).toEqual([])
  })
  it('replaces an open one with the same id, and closes the old one', () => {
    const [old, fresh, b] = [s('a'), s('a'), s('b')]
    const r = admit([b, old], fresh, 5)
    expect(r.open).toEqual([fresh, b])
    expect(r.dropped).toEqual([old])
    expect(r.open[0]).toBe(fresh)
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
      onStepBack: () => {},
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
    expect(first[0]).toMatchObject({ text: 'green', fg: T.running })
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
    // Each step waits for a line from Hopper, so the test sets the pace, not the clock.
    process.env['HOPPER_CLAUDE'] = await fake(
      'stty -echo; printf "one\\ntwo"; read -r a; printf "\\033[?25l"; read -r b; printf "\\033[?25h"; sleep 5',
    )
    const s = new EmbeddedSession(account, 'abc', 'test', 40, 6, {
      onLeave: () => {},
      onStepBack: () => {},
    })
    s.start()
    const wait = async (ok: () => boolean) => {
      for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 50))
    }
    await wait(() => s.cursor()?.col === 3)
    expect(s.cursor()).toEqual({ col: 3, row: 1 })
    s.send('\r')
    await wait(() => !s.cursor())
    expect(s.cursor()).toBeNull()
    s.send('\r')
    await wait(() => !!s.cursor())
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
      onStepBack: () => {},
      onCopy: (t) => copied.push(t),
    })
    s.start()
    for (let i = 0; i < 160 && !copied.length; i++) await new Promise((r) => setTimeout(r, 50))
    expect(copied).toEqual(['copied text'])
    s.close()
    delete process.env['HOPPER_CLAUDE']
  }, 30_000)

  it("steps back on Claude's agents screen, pressing enter to return; the session ending leaves", async () => {
    process.env['HOPPER_CLAUDE'] = await fake(
      'printf "Needs input\\n  enter to return · space to reply · ctrl+x to delete\\n"; read -r line; printf "\\033[2J\\033[Hback in it\\n"; sleep 5',
    )
    let left = 0
    let stepped = 0
    const s = new EmbeddedSession(account, 'abc', 'test', 60, 6, {
      onChange: () => {},
      onLeave: () => left++,
      onStepBack: () => stepped++,
    })
    s.start()
    const text = () =>
      s
        .screen()
        .map((r) => r.map((x) => x.text).join(''))
        .join('\n')
    for (let i = 0; i < 160 && !text().includes('back in it'); i++)
      await new Promise((r) => setTimeout(r, 50))
    expect(text()).toContain('back in it')
    expect(stepped).toBe(1)
    expect(left).toBe(0)
    s.close()
    process.env['HOPPER_CLAUDE'] = await fake('printf "bye\\n"')
    let ended = 0
    const t = new EmbeddedSession(account, 'abc', 'test', 60, 6, {
      onChange: () => {},
      onLeave: () => ended++,
      onStepBack: () => {},
    })
    t.start()
    for (let i = 0; i < 160 && !ended; i++) await new Promise((r) => setTimeout(r, 50))
    expect(ended).toBe(1)
    delete process.env['HOPPER_CLAUDE']
  }, 30_000)
})
