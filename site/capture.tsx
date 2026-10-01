// Renders the real app against the made-up world in src/demo.ts and saves what's on screen after
// each set of keys, as ANSI, for the website. Run from the repo root: pnpm site:capture.
import { EventEmitter } from 'node:events'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { render } from 'ink'

import { makeDemo } from '../src/demo.ts'
import { gather } from '../src/model.ts'
import { App } from '../src/tui/App.tsx'

const COLUMNS = 128
const ROWS = 36

class Stdout extends EventEmitter {
  isTTY = true
  columns = COLUMNS
  rows = ROWS
  last = ''
  write = (s: string) => {
    // Debug mode writes whole frames; anything else (mouse modes, titles) is a short escape.
    if (s.includes('\n')) this.last = s
    return true
  }
}

class Stdin extends EventEmitter {
  isTTY = true
  data: string | null = null
  write = (d: string) => {
    this.data = d
    this.emit('readable')
    this.emit('data', d)
  }
  read = () => {
    const d = this.data
    this.data = null
    return d
  }
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const KEY: Record<string, string> = {
  down: '\u001b[B',
  up: '\u001b[A',
  esc: '\u001b',
  tab: '\t',
  enter: '\r',
}

// Each scene starts from a fresh app and presses its keys in order.
type Scene = { id: string; keys: string[] }

const LIST_LENGTH = 12
const SCENES: Scene[] = [
  ...Array.from({ length: LIST_LENGTH }, (_, i) => ({
    id: `list-${i}`,
    keys: Array<string>(i).fill('down'),
  })),
  { id: 'help', keys: ['?'] },
  { id: 'projects', keys: ['p'] },
  { id: 'find', keys: ['p', 'l', 'a', 'n'] },
  { id: 'accounts', keys: ['a'] },
  { id: 'done', keys: ['v'] },
  { id: 'draft', keys: ['tab', ...'Add a share button to the route screen'.split('')] },
  { id: 'settings', keys: [','] },
]

async function capture(config: Parameters<typeof App>[0]['config'], scene: Scene) {
  const stdout = new Stdout()
  const stdin = new Stdin()
  const app = render(<App config={config} load={gather} chime={() => {}} autopilot={false} />, {
    stdout: stdout as never,
    stderr: new Stdout() as never,
    stdin: stdin as never,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  for (let i = 0; i < 200 && !stdout.last.includes('Fix the blurry'); i++) await sleep(25)
  await sleep(400)
  for (const k of scene.keys) {
    stdin.write(KEY[k] ?? k)
    await sleep(k.length === 1 && scene.id === 'draft' ? 15 : 120)
  }
  await sleep(500)
  const frame = stdout.last
  app.unmount()
  return frame
}

const dir = await realpath(await mkdtemp(join(tmpdir(), 'hopper-demo-')))
process.env['HOME'] = dir
try {
  const { config, claude } = await makeDemo(dir)
  process.env['HOPPER_CLAUDE'] = claude
  const frames: Record<string, string> = {}
  for (const scene of SCENES) {
    frames[scene.id] = await capture(config, scene)
    process.stdout.write(`${scene.id} `)
  }
  const out = join(import.meta.dirname, 'frames.json')
  await writeFile(out, JSON.stringify({ columns: COLUMNS, rows: ROWS, frames }, null, 1))
  console.log(`\nwrote ${out}`)
} finally {
  await rm(dir, { recursive: true, force: true })
}
process.exit(0)
