import { execFile } from 'node:child_process'
import { appendFile, mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { render } from 'ink-testing-library'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Session } from '../src/claude.ts'
import { addAccount, setPrefixes, type Config } from '../src/config.ts'
import { initHome, loadProjects } from '../src/home.ts'
import { draftSession, toItems, type Snapshot } from '../src/model.ts'
import { App } from '../src/tui/App.tsx'
import { fakeClaude } from './helpers.ts'

let config: Config = {
  path: '/c/config.toml',
  accountsPath: '/c/accounts.toml',
  home: '/h',
  accounts: [],
  routes: [],
}
config = addAccount(config, { name: 'kf', label: 'Knowledge Futures', configDir: null })
config = addAccount(config, { name: 'sb', label: 'Saltbark', configDir: '/tmp/hopper-test-sb' })
config = setPrefixes(setPrefixes(config, 'kf', ['kf/']), 'sb', ['sb/', 'meta/'])
const projects = [
  {
    key: 'meta/inbox',
    path: '/h/projects/meta/inbox',
    runIn: '/h/projects/meta/inbox',
    openFile: '',
  },
  {
    key: 'meta/ideas',
    path: '/h/projects/meta/ideas',
    runIn: '/h/projects/meta/ideas',
    openFile: '',
  },
]
const now = Date.now()
const session = (over: Partial<Session>): Session => ({
  account: 'kf',
  id: 'abc12345',
  sessionId: 's-' + over.name,
  kind: 'background',
  cwd: '/elsewhere',
  name: 'x',
  startedAt: now - 60_000,
  state: 'working',
  ...over,
})
const snapshot: Snapshot = {
  at: now,
  drafts: [],
  routines: [],
  runs: [],
  results: {},
  projects,
  projectsError: null,
  openCounts: new Map([
    ['meta/inbox', 3],
    ['meta/ideas', 0],
  ]),
  accounts: [
    {
      account: config.accounts[0]!,
      auth: { loggedIn: true, email: 'me@kf.org', subscriptionType: 'team' },
      authError: null,
      usage: {
        fiveHour: { pct: 22, resetsAt: null },
        sevenDay: { pct: 41, resetsAt: null },
        fetchedAt: now - 3_600_000,
      },
      sessionError: null,
      counts: { queue: 1, needs: 1, done: 0, live: 0 },
    },
    {
      account: config.accounts[1]!,
      auth: { loggedIn: false },
      authError: null,
      usage: null,
      sessionError: null,
      counts: { queue: 0, needs: 0, done: 0, live: 0 },
    },
  ],
  items: toItems(
    [
      session({ name: 'Sort the inbox', cwd: '/h/projects/meta/inbox', state: 'working' }),
      session({ name: 'Set up NCBI search demo', cwd: '/w/kf-meta', state: 'blocked' }),
    ],
    projects,
  ),
}

const tick = () => new Promise((r) => setTimeout(r, 30))
// Waits for something slower than a render (a child process), up to two seconds.
const until = async (ok: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 300 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 20))
}
const press = async (stdin: { write: (s: string) => void }, keys: string) => {
  stdin.write(keys)
  await tick()
}
// The key bar names the focused panel at its right end.
const focusOf = (frame: string | undefined) =>
  (frame ?? '').trimEnd().split('\n').at(-1)?.trim().split(/\s+/).at(-1)

describe('App', () => {
  it('opens on Projects and shows both accounts, the queue and what needs you', async () => {
    const { lastFrame, unmount } = render(<App config={config} load={async () => snapshot} />)
    await tick()
    const f = lastFrame() ?? ''
    expect(focusOf(f)).toBe('projects')
    expect(f).toContain('f find')
    expect(f).toContain('41%')
    expect(f).toContain('sb  not signed in')
    expect(f).toContain('Sort t')
    expect(f).toContain('WAITING ON YOU 1')
    unmount()
  })

  it('K jumps up to the nearest folder, and x quits only when pressed twice', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    await press(stdin, 'j')
    await press(stdin, 'j') // meta/inbox
    await press(stdin, 'K') // up to meta
    await press(stdin, '\u001b[1;3B') // option+↓: past meta's children to elsewhere, the next top row
    await press(stdin, '\u001b\u001b[A') // option+↑ (the other form terminals send): back to meta
    await press(stdin, 'j') // meta/ideas
    await press(stdin, '\u001b[1;3A') // option+↑ from a child: its parent
    await press(stdin, '\r')
    expect(lastFrame()).toContain('── meta ─╮')
    await press(stdin, 'x')
    expect(lastFrame()).toContain('Press x again to quit.')
    await press(stdin, 'j') // anything else lets it go
    expect(lastFrame()).not.toContain('Press x again to quit.')
    unmount()
  })

  it('j and enter focus a project; esc goes back to Projects, then clears the focus', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    await press(stdin, 'j') // meta/ideas, straight away: Projects already has focus
    await press(stdin, '\r')
    expect(focusOf(lastFrame())).toBe('conversations')
    expect(lastFrame()).toContain('(c) ─ meta/ideas')
    expect(lastFrame()).toContain('Nothing going on.')
    await press(stdin, '\u001b')
    expect(focusOf(lastFrame())).toBe('projects')
    expect(lastFrame()).toContain('(c) ─ meta/ideas')
    await press(stdin, '\u001b')
    expect(focusOf(lastFrame())).toBe('projects')
    expect(lastFrame()).toContain('(c) ─ all proje')
    expect(lastFrame()).toContain('Sort t')
    unmount()
  })

  it('the wheel moves the selection in the list under the pointer, and a click focuses it', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    // At 100 columns the list is in columns 33 to 68. Click it, then wheel down a row.
    await press(stdin, '\u001b[<0;40;5M')
    expect(focusOf(lastFrame())).toBe('conversations')
    await press(stdin, '\u001b[<65;40;5M')
    // Down one: from the waiting session to the running one, shown in SELECTED.
    expect(lastFrame()).toContain('Sort t')
    unmount()
  })

  it('→ and ← move between the projects column and the list', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    await press(stdin, '\u001b[C')
    expect(focusOf(lastFrame())).toBe('conversations')
    await press(stdin, '\u001b[D')
    expect(focusOf(lastFrame())).toBe('projects')
    unmount()
  })

  it('→ on the list does what ⏎ does: opens what is selected', async () => {
    const d = {
      id: 'd1',
      project: 'meta/inbox',
      text: 'a waiting draft',
      created: now,
      updated: now,
    }
    const item = { ...draftSession(d, projects, 'kf'), where: 'needs' as const, key: 'meta/inbox' }
    const snap = { ...snapshot, drafts: [d], items: [item] }
    const { lastFrame, stdin, unmount } = render(<App config={config} load={async () => snap} />)
    await tick()
    await press(stdin, '\u001b[C') // projects → the list
    await press(stdin, '\u001b[C') // → opens the draft, as ⏎ would
    expect(lastFrame()).toContain(' draft ')
    expect(lastFrame()).toContain('a waiting draft')
    unmount()
  })

  it('f finds a project by a few letters and focuses it', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    await press(stdin, 'f')
    expect(lastFrame()).toContain(' find ')
    await press(stdin, 'ide')
    expect(lastFrame()).toContain(' find   ide')
    expect(lastFrame()).toContain(' 1 found ─╮')
    await press(stdin, '\r')
    expect(focusOf(lastFrame())).toBe('conversations')
    expect(lastFrame()).toContain('(c) ─ meta/ideas')
    unmount()
  })

  it('v goes to Done, below the one list', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    await press(stdin, 'v')
    expect(focusOf(lastFrame())).toBe('done')
    expect(lastFrame()).toContain('Nothing marked done yet.')
    unmount()
  })

  it('edits an account from the accounts panel and saves it', async () => {
    const saved: Config[] = []
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} save={async (c) => void saved.push(c)} />,
    )
    await tick()
    await press(stdin, 'a')
    expect(lastFrame()).toContain('kf/ as choice 1')
    await press(stdin, 'e')
    expect(lastFrame()).toContain('prefixes it runs')
    await press(stdin, ', meta')
    await press(stdin, '\r')
    expect(saved.at(-1)?.routes).toEqual([
      { prefix: 'kf/', accounts: ['kf'] },
      { prefix: 'meta/', accounts: ['sb', 'kf'] },
      { prefix: 'sb/', accounts: ['sb'] },
    ])
    await press(stdin, '1')
    expect(saved.at(-1)?.routes[1]).toEqual({ prefix: 'meta/', accounts: ['kf', 'sb'] })
    await press(stdin, 'j')
    await press(stdin, 'd')
    expect(lastFrame()).toContain('Remove sb from Hopper?')
    await press(stdin, 'y')
    expect(saved.at(-1)?.accounts.map((a) => a.name)).toEqual(['kf'])
    unmount()
  })

  it('refuses a bad prefix without saving, and says why', async () => {
    const saved: Config[] = []
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} save={async (c) => void saved.push(c)} />,
    )
    await tick()
    await press(stdin, 'a')
    await press(stdin, 'e')
    await press(stdin, ' Not A Prefix')
    await press(stdin, '\r')
    expect(saved).toHaveLength(0)
    expect(lastFrame()).toContain('is not a prefix')
    unmount()
  })
})

describe('conversations', () => {
  // One stand-in claude for the whole file: macOS scans a new executable the first time it
  // runs, which can take seconds. Its behaviour and log come from each call's environment.
  let bin = ''
  beforeAll(async () => {
    bin = await fakeClaude(
      'echo "$PWD|$*" >> "$HOPPER_FAKE_LOG"\n' +
        'case "$1" in --bg) if [ -n "$HOPPER_FAKE_UNTRUSTED" ]; then echo "Workspace not trusted."; exit 1; fi; echo "backgrounded · abc12345 · name";;\n' +
        '  attach) printf "fake claude screen\\n❯ "; while read -r line; do printf "you said: %s\\n❯ " "$line"; done;; esac\n' +
        'exit 0',
    )
    await new Promise<void>((resolve) =>
      execFile(bin, ['warm-up'], { env: { ...process.env, HOPPER_FAKE_LOG: '/dev/null' } }, () =>
        resolve(),
      ),
    )
  })
  const setup = async (opts: { untrusted?: boolean } = {}) => {
    const home = await mkdtemp(join(tmpdir(), 'hopper-app-'))
    await initHome(home)
    await appendFile(join(home, 'projects.toml'), '\n[[project]]\nkey = "kf/console"\n')
    const log = join(home, 'calls.log')
    process.env['HOPPER_CLAUDE'] = bin
    process.env['HOPPER_FAKE_LOG'] = log
    if (opts.untrusted) process.env['HOPPER_FAKE_UNTRUSTED'] = '1'
    else delete process.env['HOPPER_FAKE_UNTRUSTED']
    const projects = await loadProjects(home)
    const cfg: Config = { ...setPrefixes(config, 'kf', ['kf/', 'meta/']), home }
    const snap: Snapshot = { ...snapshot, projects, items: [] }
    return { home, cfg, snap, projects, log }
  }
  const calls = async (log: string) =>
    (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean)
  const done = () => {
    delete process.env['HOPPER_CLAUDE']
    delete process.env['HOPPER_FAKE_UNTRUSTED']
  }

  it('t opens a draft where enter is a new line; esc then s starts it and opens it', async () => {
    const { cfg, snap, projects, log } = await setup()
    const { lastFrame, stdin, unmount } = render(<App config={cfg} load={async () => snap} />)
    await tick()
    await press(stdin, 't')
    expect(lastFrame()).toContain('NEW CONVERSATION')
    expect(lastFrame()).toContain(' draft  meta/inbox')
    await press(stdin, 'backups for the home folder')
    await press(stdin, '\r')
    await press(stdin, 'nightly, somewhere off this machine')
    expect(await calls(log)).toEqual([]) // nothing starts while writing
    await press(stdin, '\u001b')
    expect(lastFrame()).toContain('s start it')
    await press(stdin, 's')
    await until(() => (lastFrame() ?? '').includes('fake claude screen'))
    const inbox = projects.find((p) => p.key === 'meta/inbox')!
    const logged = await readFile(log, 'utf8')
    // It runs from the home folder, not the project's own; the fake logs the physical cwd.
    expect(logged).toContain(
      `${await realpath(inbox.runIn)}|--bg --name meta/inbox · backups for the home folder`,
    )
    // The first message goes to Claude as written, new lines and all.
    expect(logged).toContain('backups for the home folder\nnightly, somewhere off this machine')
    expect(logged).toContain('|attach abc12345')
    // The conversation is inside Hopper, and typing goes to it.
    expect(lastFrame()).toContain('CONVERSATION')
    expect(lastFrame()).toContain(' claude ')
    await press(stdin, 'thanks')
    await press(stdin, '\r')
    await until(() => (lastFrame() ?? '').includes('you said: thanks'))
    expect(lastFrame()).toContain('you said: thanks')
    // esc comes back to Hopper and leaves the conversation live in the panel; ⏎ goes back in.
    await press(stdin, '\u001b')
    expect(focusOf(lastFrame())).toBe('conversations')
    expect(lastFrame()).toContain('you said: thanks')
    await press(stdin, '\r')
    expect(lastFrame()).toContain(' claude ')
    // Dragging across the conversation selects inside it and copies on release. At 100 columns
    // the right panel's cells start at column 70, row 2, under the panel's top edge.
    const clip = join(tmpdir(), `hopper-clip-${Date.now()}`)
    process.env['HOPPER_CLIPBOARD_FILE'] = clip
    await press(stdin, '\u001b[<0;70;2M') // press on "fake claude screen"
    await press(stdin, '\u001b[<32;73;2M') // drag four cells right
    await press(stdin, '\u001b[<0;73;2m') // let go
    expect(await readFile(clip, 'utf8')).toBe('fake')
    expect(lastFrame()).toContain('Copied 4 characters')
    delete process.env['HOPPER_CLIPBOARD_FILE']
    // ctrl+] closes the view outright.
    await press(stdin, '\u001d')
    expect(focusOf(lastFrame())).toBe('conversations')
    done()
    unmount()
  })

  it('esc twice keeps a draft; it shows in Needs you and enter keeps writing', async () => {
    const { home, cfg } = await setup()
    const { lastFrame, stdin, unmount } = render(<App config={cfg} />) // the real loader: drafts come from disk
    await tick()
    await press(stdin, 't')
    await press(stdin, 'maybe a weekly digest')
    await press(stdin, '\u001b')
    await press(stdin, '\u001b')
    expect(lastFrame()).toContain('Kept as a draft')
    await until(() => (lastFrame() ?? '').includes('DRAFTS 1'))
    expect(lastFrame()).toContain('DRAFTS 1')
    const { listDrafts } = await import('../src/drafts.ts')
    expect((await listDrafts(home)).map((d) => d.text)).toEqual(['maybe a weekly digest'])
    await press(stdin, 'n')
    await press(stdin, '\r')
    expect(lastFrame()).toContain('NEW CONVERSATION')
    await press(stdin, ' of what agents did')
    await press(stdin, '\u001b')
    await press(stdin, 'x') // throw it away
    await until(async () => (await listDrafts(home)).length === 0)
    expect(await listDrafts(home)).toEqual([])
    done()
    unmount()
  })

  it('the draft is a real text box: arrows move the cursor, shift selects, typing replaces', async () => {
    const { cfg, snap } = await setup()
    const { lastFrame, stdin, unmount } = render(<App config={cfg} load={async () => snap} />)
    await tick()
    await press(stdin, 't')
    await press(stdin, 'hello world')
    for (let i = 0; i < 5; i++) await press(stdin, '\u001b[D') // ← five times: before "world"
    await press(stdin, 'big ')
    expect(lastFrame()).toContain('hello big world')
    await press(stdin, '\u001b[F') // end
    for (let i = 0; i < 5; i++) await press(stdin, '\u001b[1;2D') // shift+← five times: "world"
    await press(stdin, 'there')
    expect(lastFrame()).toContain('hello big there')
    await press(stdin, '\u001bb') // option+← (as Mac terminals send it): back a word
    await press(stdin, 'out ')
    expect(lastFrame()).toContain('hello big out there')
    done()
    unmount()
  })

  it('m and e choose the model and effort, and they go to Claude and are recorded', async () => {
    const { home, cfg, snap, log } = await setup()
    const { lastFrame, stdin, unmount } = render(<App config={cfg} load={async () => snap} />)
    await tick()
    await press(stdin, 't')
    await press(stdin, 'sort the inbox')
    await press(stdin, '\u001b')
    await press(stdin, 'm') // haiku
    await press(stdin, 'e') // low
    expect(lastFrame()).toContain('m model (haiku) · e effort (low)')
    await press(stdin, 's')
    await until(async () => (await readFile(log, 'utf8').catch(() => '')).includes('attach'))
    const logged = await readFile(log, 'utf8')
    expect(logged).toContain('--model haiku --effort low')
    const { loadConversations } = await import('../src/conversations.ts')
    expect((await loadConversations(home))['abc12345']).toMatchObject({
      model: 'haiku',
      effort: 'low',
    })
    await press(stdin, '\u001d')
    done()
    unmount()
  })

  it('r turns a draft into a routine, saves it and syncs the schedule', async () => {
    const { home, cfg, snap } = await setup()
    const synced: string[][] = []
    const { lastFrame, stdin, unmount } = render(
      <App
        config={cfg}
        load={async () => snap}
        syncSchedule={async (_c, rs) => void synced.push(rs.map((r) => r.name))}
      />,
    )
    await tick()
    await press(stdin, 't')
    await press(stdin, 'triage the inbox')
    await press(stdin, '\u001b')
    expect(lastFrame()).toContain('r make it a routine')
    await press(stdin, 'r')
    expect(lastFrame()).toContain('name this routine')
    expect(lastFrame()).toContain('triage-the-inbox')
    await press(stdin, '\r') // keep the suggested name
    expect(lastFrame()).toContain('when it runs')
    await press(stdin, '\r') // keep weekdays 9:00
    await until(() => synced.length > 0)
    expect(synced.at(-1)).toEqual(['triage-the-inbox'])
    const { loadRoutine } = await import('../src/routines/index.ts')
    expect(await loadRoutine(home, 'triage-the-inbox')).toMatchObject({
      project: 'meta/inbox',
      schedule: 'weekdays 9:00',
      prompt: 'triage the inbox',
      enabled: true,
    })
    const { listDrafts } = await import('../src/drafts.ts')
    expect(await listDrafts(home)).toEqual([]) // no longer a draft
    done()
    unmount()
  })

  it('a routine sits in the routines group; ⏎ opens it and s runs it now, as its own conversation', async () => {
    const { home, cfg, snap, projects, log } = await setup()
    const { saveRoutine } = await import('../src/routines/index.ts')
    const routine = {
      name: 'triage',
      project: 'meta/inbox',
      schedule: '',
      enabled: true,
      prompt: 'Sort the inbox.',
      model: 'haiku',
    }
    await saveRoutine(home, routine)
    const inbox = projects.find((p) => p.key === 'meta/inbox')!
    const withRoutine: Snapshot = {
      ...snap,
      routines: [routine],
      items: toItems(
        [
          {
            account: 'kf',
            id: null,
            sessionId: 'routine:triage',
            kind: 'routine',
            cwd: inbox.path,
            name: 'triage',
            startedAt: 0,
            state: 'manual',
          },
        ],
        projects,
      ),
    }
    const { lastFrame, stdin, unmount } = render(
      <App config={cfg} load={async () => withRoutine} syncSchedule={async () => {}} />,
    )
    await tick()
    await press(stdin, 'c')
    expect(lastFrame()).toContain('ROUTINES')
    await press(stdin, '\r')
    expect(lastFrame()).toContain('ROUTINE triage')
    expect(lastFrame()).toContain('s run now')
    await press(stdin, 's')
    await until(() => (lastFrame() ?? '').includes('fake claude screen'))
    const logged = await readFile(log, 'utf8')
    expect(logged).toContain('--bg --name ↻ triage')
    expect(logged).toContain('--model haiku')
    const { listRuns } = await import('../src/routines/index.ts')
    expect((await listRuns(home, 'triage'))[0]).toMatchObject({ status: 'started', id: 'abc12345' })
    await press(stdin, '\u001d')
    done()
    unmount()
  })

  it('p moves a draft to another project before it starts', async () => {
    const { cfg, snap } = await setup()
    const { lastFrame, stdin, unmount } = render(<App config={cfg} load={async () => snap} />)
    await tick()
    await press(stdin, 't')
    await press(stdin, 'an idea')
    await press(stdin, '\u001b')
    await press(stdin, 'p')
    expect(lastFrame()).toContain('MOVE TO PROJECT')
    await press(stdin, 'con')
    await press(stdin, '\r')
    expect(lastFrame()).toContain(' draft  kf/console')
    done()
    unmount()
  })

  it('an untrusted folder says so and offers T, keeping the draft', async () => {
    const { home, cfg, snap } = await setup({ untrusted: true })
    const { lastFrame, stdin, unmount } = render(<App config={cfg} load={async () => snap} />)
    await tick()
    await press(stdin, 't')
    await press(stdin, 'hello')
    await press(stdin, '\u001b')
    await press(stdin, 's')
    await until(() => (lastFrame() ?? '').includes('T opens Claude once'))
    expect(lastFrame()).toContain('T opens Claude once')
    const { listDrafts } = await import('../src/drafts.ts')
    expect((await listDrafts(home)).map((d) => d.text)).toEqual(['hello'])
    done()
    unmount()
  })

  it('m marks a finished conversation done, in Hopper’s own state', async () => {
    const { home, cfg, projects } = await setup()
    const inbox = projects.find((p) => p.key === 'meta/inbox')!
    const snap: Snapshot = {
      ...snapshot,
      projects,
      items: toItems(
        [session({ name: 'Backups chat', cwd: inbox.path, state: 'done', sessionId: 'sess-1' })],
        projects,
      ),
    }
    const { lastFrame, stdin, unmount } = render(<App config={cfg} load={async () => snap} />)
    await tick()
    await press(stdin, 'n')
    expect(lastFrame()).toContain('Backups chat')
    await press(stdin, 'm')
    await until(() => (lastFrame() ?? '').includes('Done: Backups chat'))
    expect(JSON.parse(await readFile(join(home, 'state', 'done.json'), 'utf8'))).toEqual({
      sessions: ['sess-1'],
    })
    done()
    unmount()
  })
})
