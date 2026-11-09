// A made-up Claude for demo-mac.ts: what opening a conversation on the phone shows in the
// simulator, where there's no real `claude attach` behind the demo's items. It draws a short
// conversation from the top and a question with its prompt pinned to the bottom of the tall
// screen, as Claude does, echoes what's typed, and adds a reply when Enter goes.

import type { Spawn } from '../../src/remote/screen.ts'
import type { Seg } from '../../src/tui/embed.ts'

const C = {
  dim: '#838d88',
  you: '#a7b0ab',
  claude: '#e8a07a',
  tool: '#7fcf8f',
  path: '#a3c3f0',
  ask: '#e5c06a',
  rule: '#2a363c',
}

const wrap = (text: string, width: number): string[] => {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) out.push(line)
  return out
}

export const demoSpawn: Spawn = (_account, _id, _name, cols, rows) => {
  let width = cols
  let typed = ''
  let replies = 0
  let redraw: () => void = () => {}
  const said: Seg[][] = []

  const say = (lead: Seg, text: string, fg?: string) => {
    wrap(text, width - 4).forEach((l, i) =>
      said.push([i === 0 ? lead : { text: '  ' }, { text: l, ...(fg ? { fg } : {}) }]),
    )
    said.push([])
  }
  say(
    { text: '> ', fg: C.you },
    'Fix the blurry tiles at zoom 14. They look soft on retina screens.',
    C.you,
  )
  say(
    { text: '⏺ ', fg: C.claude },
    "I'll look at how tiles are picked for the screen's scale. The retina path is in tiles/scale.ts.",
  )
  said.push([
    { text: '⏺ ', fg: C.tool },
    { text: 'Read', bold: true },
    { text: '(tiles/scale.ts)', fg: C.path },
  ])
  said.push([{ text: '  ⎿  Read 84 lines', fg: C.dim }])
  said.push([])
  said.push([
    { text: '⏺ ', fg: C.tool },
    { text: 'Update', bold: true },
    { text: '(tiles/scale.ts)', fg: C.path },
  ])
  said.push([{ text: '  ⎿  Updated with 2 additions and 1 removal', fg: C.dim }])
  said.push([
    { text: '     41 ', fg: C.dim },
    { text: '-  const z = Math.floor(zoom)', fg: '#ec7a6f' },
  ])
  said.push([
    { text: '     41 ', fg: C.dim },
    { text: '+  const z = Math.round(zoom + Math.log2(dpr))', fg: '#7fcf8f' },
  ])
  said.push([])
  say(
    { text: '⏺ ', fg: C.claude },
    'Tiles now come from one zoom level up on a 2x screen, so zoom 14 is sharp. Shall I run the visual tests?',
  )

  const screen = (): Seg[][] => {
    const out: Seg[][] = Array.from({ length: rows }, () => [])
    said.forEach((r, i) => {
      if (i < rows - 8) out[i] = r
    })
    const bottom = rows - 7
    out[bottom] = [{ text: '─'.repeat(width), fg: C.rule }]
    out[bottom + 1] = [{ text: ' Run the visual tests?', bold: true }]
    out[bottom + 2] = [{ text: ' ❯ 1. Yes', fg: C.ask }]
    out[bottom + 3] = [{ text: "   2. Yes, and don't ask again for this command" }]
    out[bottom + 4] = [{ text: '   3. No, and tell Claude what to do differently' }]
    out[bottom + 5] = [{ text: '─'.repeat(width), fg: C.rule }]
    out[bottom + 6] = [{ text: '> ', fg: C.dim }, { text: typed }]
    return out
  }

  return {
    start: () => setTimeout(() => redraw(), 50),
    subscribe: (fn: () => void) => {
      redraw = fn
      return () => true
    },
    screen,
    cursor: () => ({ col: 2 + typed.length, row: rows - 1 }),
    send: (d: string) => {
      if (d === '\r') {
        if (typed) say({ text: '> ', fg: C.you }, typed, C.you)
        say({ text: '⏺ ', fg: C.claude }, `Reply ${++replies}: on it.`)
        typed = ''
      } else if (d === '\x7f') typed = typed.slice(0, -1)
      else if (!d.startsWith('\x1b')) typed += d
      redraw()
    },
    paste: (t: string) => {
      typed += t
      redraw()
    },
    resize: (c: number) => {
      width = c
      redraw()
    },
    wheel: () => {},
    close: () => {},
    reclaim: () => redraw(),
    hasSize: () => true,
  }
}
