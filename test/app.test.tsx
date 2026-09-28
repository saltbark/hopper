import { execFile } from 'node:child_process'
import { appendFile, mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { render } from 'ink-testing-library'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Session } from '../src/claude.ts'
import { addAccount, OVERNIGHT_DEFAULTS, setPrefixes, type Config } from '../src/config.ts'
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
  overnight: OVERNIGHT_DEFAULTS,
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
// After esc a draft is saved and selected on the list, its text on the right.
const onList = (frame: () => string | undefined) =>
  until(() => (frame() ?? '').includes('⏎ TO KEEP WRITING')) // the heading is upper case
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

  it('titles the tab with how many conversations need you', async () => {
    const titles: string[] = []
    const { unmount } = render(
      <App config={config} load={async () => snapshot} setTitle={(t) => titles.push(t)} />,
    )
    await until(() => titles.at(-1) === 'Hopper (1)')
    expect(titles.at(0)).toBe('Hopper')
    expect(titles.at(-1)).toBe('Hopper (1)')
    unmount()
  })

  it('lists projects with something going on first, by full key, above the tree', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    const lines = (lastFrame() ?? '').split('\n')
    const first = lines.findIndex((l) => l.includes('meta/inbox'))
    const tree = lines.findIndex((l) => /▾ meta\b/.test(l))
    expect(first).toBeGreaterThan(0)
    expect(tree).toBeGreaterThan(first)
    expect(lines.slice(first, tree).join('\n')).toMatch(/ all ─/)
    await press(stdin, '\r') // ⏎ on it narrows the list to it, as on the tree
    expect(lastFrame()).toMatch(/\(c\) ─+ meta\/inbox/)
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
    // Past meta/inbox, listed first because something is running there, and the meta folder,
    // to meta/ideas. Straight away: Projects already has focus.
    await press(stdin, 'j')
    await press(stdin, 'j')
    await press(stdin, '\r')
    expect(focusOf(lastFrame())).toBe('conversations')
    expect(lastFrame()).toMatch(/\(c\) ─+ meta\/ideas/)
    expect(lastFrame()).toContain('Nothing going on.')
    await press(stdin, '\u001b')
    expect(focusOf(lastFrame())).toBe('projects')
    expect(lastFrame()).toMatch(/\(c\) ─+ meta\/ideas/)
    await press(stdin, '\u001b')
    expect(focusOf(lastFrame())).toBe('projects')
    expect(lastFrame()).toMatch(/\(c\) ─+ all projects/)
    expect(lastFrame()).toContain('Sort t')
    unmount()
  })

  it('a click selects a project, and a second click on it focuses it, as ⏎ would', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    await press(stdin, 'c') // the list has the keyboard, so the first click is only a select
    // Mouse lines count from 1; so do the frame's.
    const y = (lastFrame() ?? '').split('\n').findIndex((l) => /\bideas\b/.test(l)) + 1
    const click = `\u001b[<0;40;${y}M`
    await press(stdin, `\u001b[<35;40;${y}M`) // moving over it changes nothing
    expect(focusOf(lastFrame())).toBe('conversations')
    await press(stdin, click)
    expect(focusOf(lastFrame())).toBe('projects')
    expect(lastFrame()).toMatch(/\(c\) ─+ all projects/)
    await press(stdin, click)
    expect(lastFrame()).toMatch(/\(c\) ─+ meta\/ideas/)
    unmount()
  })

  it('a click on a folder’s ▾ folds it, and on its ▸ unfolds it', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    const lines = (lastFrame() ?? '').split('\n')
    const y = lines.findIndex((l) => /▾ meta\b/.test(l))
    const x = lines[y]!.indexOf('▾') + 1
    await press(stdin, `\u001b[<0;${x};${y + 1}M`)
    expect(lastFrame()).toMatch(/▸ meta\b/)
    expect(lastFrame()).not.toMatch(/\bideas\b/)
    await press(stdin, `\u001b[<0;${x};${y + 1}M`)
    expect(lastFrame()).toMatch(/▾ meta\b/)
    expect(lastFrame()).toMatch(/\bideas\b/)
    unmount()
  })

  it('a click selects an account', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    const y = (lastFrame() ?? '').split('\n').findIndex((l) => l.includes('sb  not signed in'))
    await press(stdin, `\u001b[<0;5;${y + 1}M`)
    expect(focusOf(lastFrame())).toBe('accounts')
    expect(lastFrame()).toContain('│▌sb  not signed in')
    expect(lastFrame()).toContain('sb · Saltbark')
    unmount()
  })

  it('the wheel moves the selection in the list under the pointer, and a click focuses it', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    // The list is under the band of accounts and projects, across the first 68 columns.
    await press(stdin, '\u001b[<0;40;12M')
    expect(focusOf(lastFrame())).toBe('conversations')
    await press(stdin, '\u001b[<65;40;12M')
    // Down one: from the waiting session to the running one, shown in SELECTED.
    expect(lastFrame()).toContain('Sort t')
    unmount()
  })

  it('moving over a row leaves the selection alone; a click selects it', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    // The list's frame starts on line 9: a heading, the waiting session, a gap, a heading, then
    // the running one on line 14.
    await press(stdin, '\u001b[<35;20;14M')
    expect(focusOf(lastFrame())).toBe('projects')
    await press(stdin, '\u001b[<0;20;14M')
    expect(focusOf(lastFrame())).toBe('conversations')
    expect(lastFrame()).toMatch(/│ Sort the inbox  +│/)
    // A click on a heading only gives the list the keyboard.
    await press(stdin, '\u001b[<0;20;10M')
    expect(lastFrame()).toMatch(/│ Sort the inbox  +│/)
    unmount()
  })

  it('a second click on the selected row opens it, as ⏎ would', async () => {
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
    await press(stdin, '\u001b[<0;20;11M')
    expect(focusOf(lastFrame())).toBe('conversations')
    expect(lastFrame()).not.toContain('NEW CONVERSATION')
    await press(stdin, '\u001b[<0;20;11M')
    expect(lastFrame()).toContain('NEW CONVERSATION')
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

  it('a click on the details of something not open opens it, as ⏎ would', async () => {
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
    await press(stdin, '\u001b[C') // projects → the list; the draft's details are on the right
    expect(lastFrame()).not.toContain('NEW CONVERSATION')
    // At 100 columns the right panel starts at column 69.
    await press(stdin, '\u001b[<0;80;6M')
    expect(lastFrame()).toContain('NEW CONVERSATION')
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
    expect(lastFrame()).toMatch(/\(c\) ─+ meta\/ideas/)
    unmount()
  })

  it('tab in find starts a conversation in the project found, without focusing it', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    await press(stdin, 'f')
    await press(stdin, 'ide')
    await press(stdin, '\t')
    expect(lastFrame()).toContain('NEW CONVERSATION')
    expect(lastFrame()).toContain('meta/ideas')
    // The list wasn't narrowed to it.
    expect(lastFrame()).toContain('all proje')
    unmount()
  })

  it('v goes to Done, below the one list', async () => {
    const { lastFrame, stdin, unmount } = render(
      <App config={config} load={async () => snapshot} />,
    )
    await tick()
    await press(stdin, 'v')
    expect(focusOf(lastFrame())).toBe('done')
    expect(lastFrame()).toContain('Nothing done.')
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
        '  attach) printf "fake claude screen\\n❯ "; while read -r line; do case "$line" in leave) printf "  enter to return · space to reply\\n";; box) printf "the prompt box\\n──────────\\n❯ \\n──────────\\033[1A\\r\\033[2C";; "") printf "\\033[2J\\033[Hback in the conversation\\n❯ ";; *) printf "you said: %s\\n❯ " "$line";; esac; done;; esac\n' +
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
    // The signed-in accounts above, with the drafts as they are on disk: esc leaves a draft on
    // the list, and the list's keys act on it there. A conversation the fake has started shows
    // as running, as it would in claude agents.
    const live = async (): Promise<Snapshot> => {
      const { listDrafts } = await import('../src/drafts.ts')
      const drafts = await listDrafts(home)
      const started = (await readFile(log, 'utf8').catch(() => '')).includes('--bg')
      const items = toItems(
        [
          ...drafts.map((d) => draftSession(d, projects, 'kf')),
          ...(started ? [session({ name: 'started', cwd: projects[0]!.runIn })] : []),
        ],
        projects,
      )
      for (const it of items) {
        const d = drafts.find((x) => `draft:${x.id}` === it.sessionId)
        if (d) Object.assign(it, { key: d.project, model: d.model, effort: d.effort })
      }
      return { ...snap, drafts, items }
    }
    return { home, cfg, snap, projects, log, live }
  }
  const calls = async (log: string) =>
    (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean)
  const done = () => {
    delete process.env['HOPPER_CLAUDE']
    delete process.env['HOPPER_FAKE_UNTRUSTED']
  }

  it('tab opens a draft where enter is a new line; esc leaves it on the list, s starts it', async () => {
    const { cfg, projects, log, live } = await setup()
    const { lastFrame, stdin, unmount } = render(<App config={cfg} load={live} />)
    await tick()
    await press(stdin, '\t')
    expect(lastFrame()).toContain('NEW CONVERSATION')
    expect(lastFrame()).toContain(' draft  meta/inbox')
    await press(stdin, 'backups for the home folder')
    await press(stdin, '\r')
    await press(stdin, 'nightly, somewhere off this machine')
    expect(await calls(log)).toEqual([]) // nothing starts while writing
    await press(stdin, '\u001b')
    await onList(lastFrame)
    expect(lastFrame()).toContain('s  start it')
    expect(lastFrame()).toContain('nightly, somewhere')
    await press(stdin, 's')
    // Starting doesn't open it or take the keyboard: it shows as running, and ⏎ opens it.
    await until(() => (lastFrame() ?? '').includes('Started on'))
    expect(await readFile(log, 'utf8')).not.toContain('|attach')
    expect(lastFrame()).not.toContain('fake claude screen')
    await press(stdin, '\r')
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
    // ctrl+] comes back to Hopper and leaves the conversation live in the panel; ⏎ goes back in.
    await press(stdin, '\u001d')
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
    // Claude's own leave (its agents screen) comes back to Hopper too: Hopper presses enter to
    // return attach to the conversation, and it stays live in the panel.
    await press(stdin, 'leave')
    await press(stdin, '\r')
    await until(() => (lastFrame() ?? '').includes('back in the conversation'))
    expect(focusOf(lastFrame())).toBe('conversations')
    expect(lastFrame()).toContain('back in the conversation')
    // → goes back in.
    await press(stdin, '\u001b[C')
    expect(lastFrame()).toContain(' claude ')
    // At Claude's empty prompt (a one-line box, nothing typed), ← steps back at once and the
    // key never reaches Claude: what's typed next arrives clean.
    await press(stdin, 'box')
    await press(stdin, '\r')
    await until(() => (lastFrame() ?? '').includes('the prompt box'))
    await new Promise((r) => setTimeout(r, 200))
    await press(stdin, '\u001b[D')
    expect(focusOf(lastFrame())).toBe('conversations')
    await press(stdin, '\u001b[C')
    await press(stdin, 'clean')
    await press(stdin, '\r')
    await until(() => (lastFrame() ?? '').includes('you said: clean'))
    expect(lastFrame()).toContain('you said: clean')
    // esc is Claude's: it stays in the conversation.
    await press(stdin, '\u001b')
    expect(lastFrame()).toContain(' claude ')
    done()
    unmount()
  })

  it('a proposed draft has its own group, and u queues it: when there is room, tonight, off', async () => {
    const { home, cfg } = await setup()
    const { listDrafts, saveDraft } = await import('../src/drafts.ts')
    await saveDraft(home, {
      id: 'mul0-abcd',
      project: 'meta/inbox',
      text: 'tidy the README\n',
      created: 1,
      updated: 1,
      proposed: 'groomer',
      done: 'the README matches the commands',
    })
    const { lastFrame, stdin, unmount } = render(<App config={cfg} />)
    await tick()
    await press(stdin, 'c')
    await until(() => (lastFrame() ?? '').includes('PROPOSED 1'))
    expect(lastFrame()).toContain('proposed · u queues it')
    expect(lastFrame()).toContain('groomer')
    await press(stdin, 'u')
    await until(async () => (await listDrafts(home))[0]?.queue === 'now')
    const [queued] = await listDrafts(home)
    expect(queued).toMatchObject({ queue: 'now', done: 'the README matches the commands' })
    expect(queued?.proposed).toBeUndefined()
    await until(() => (lastFrame() ?? '').includes('up next: tonight'))
    expect(lastFrame()).toContain('UP NEXT 1')
    await press(stdin, 'u')
    await until(async () => (await listDrafts(home))[0]?.queue === 'night')
    // The next press acts on the list as refreshed.
    await until(() => (lastFrame() ?? '').includes('up next: off'))
    expect(lastFrame()).toContain('queued for tonight')
    await press(stdin, 'u')
    await until(async () => !(await listDrafts(home))[0]?.queue)
    expect((await listDrafts(home))[0]?.queue).toBeUndefined()
    done()
    unmount()
  }, 15_000)

  it('esc keeps a draft on the list; only enter goes back to writing; d throws it away', async () => {
    const { home, cfg } = await setup()
    const { lastFrame, stdin, unmount } = render(<App config={cfg} />) // the real loader: drafts come from disk
    await tick()
    await press(stdin, '\t')
    await press(stdin, 'maybe a weekly digest')
    await press(stdin, '\u001b')
    await onList(lastFrame)
    expect(lastFrame()).toContain('DRAFTS 1')
    expect(lastFrame()).not.toContain('NEW CONVERSATION')
    const { listDrafts } = await import('../src/drafts.ts')
    expect((await listDrafts(home)).map((d) => d.text)).toEqual(['maybe a weekly digest'])
    await press(stdin, 'q') // not a key of the draft's: it doesn't reopen it
    expect(lastFrame()).not.toContain('NEW CONVERSATION')
    await press(stdin, '\r')
    expect(lastFrame()).toContain('NEW CONVERSATION')
    await press(stdin, ' of what agents did')
    await press(stdin, '\u001b')
    await until(async () =>
      (await listDrafts(home)).some((d) => d.text.endsWith('of what agents did')),
    )
    await onList(lastFrame)
    await press(stdin, 'd')
    expect(lastFrame()).toContain('Throw away the draft')
    await press(stdin, 'y')
    await until(async () => (await listDrafts(home)).length === 0)
    expect(await listDrafts(home)).toEqual([])
    done()
    unmount()
  })

  it('the draft is a real text box: arrows move the cursor, shift selects, typing replaces', async () => {
    const { cfg, snap } = await setup()
    const { lastFrame, stdin, unmount } = render(<App config={cfg} load={async () => snap} />)
    await tick()
    await press(stdin, '\t')
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
    await press(stdin, '\u001b\u007f') // option+backspace (option as meta): a word
    expect(lastFrame()).toContain('hello big there')
    await press(stdin, '\u0017') // ctrl+w: a word, whatever the terminal's option setting
    expect(lastFrame()).toContain('hello there')
    done()
    unmount()
  })

  it('m and e choose the model and effort, and they go to Claude and are recorded', async () => {
    const { home, cfg, log, live } = await setup()
    const { lastFrame, stdin, unmount } = render(<App config={cfg} load={live} />)
    await tick()
    await press(stdin, '\t')
    await press(stdin, 'sort the inbox')
    await press(stdin, '\u001b')
    await onList(lastFrame)
    await press(stdin, 'm') // haiku
    await until(() => (lastFrame() ?? '').includes('model (haiku)'))
    await press(stdin, 'e') // low
    await until(() => (lastFrame() ?? '').includes('effort (low)'))
    expect(lastFrame()).toContain('haiku · low')
    await press(stdin, 's')
    await until(() => (lastFrame() ?? '').includes('Started on'))
    const logged = await readFile(log, 'utf8')
    expect(logged).toContain('--model haiku --effort low')
    expect(logged).not.toContain('|attach')
    const { loadConversations } = await import('../src/conversations.ts')
    expect((await loadConversations(home))['abc12345']).toMatchObject({
      model: 'haiku',
      effort: 'low',
    })
    done()
    unmount()
  })

  it('r turns a draft into a routine, saves it and syncs the schedule', async () => {
    const { home, cfg, live } = await setup()
    const synced: string[][] = []
    const { lastFrame, stdin, unmount } = render(
      <App
        config={cfg}
        load={live}
        syncSchedule={async (_c, rs) => void synced.push(rs.map((r) => r.name))}
      />,
    )
    await tick()
    await press(stdin, '\t')
    await press(stdin, 'triage the inbox')
    await press(stdin, '\u001b')
    await onList(lastFrame)
    expect(lastFrame()).toContain('r  make it a routine')
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

  it('a routine sits in the routines group; s on its row runs it now, as its own conversation', async () => {
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
    expect(lastFrame()).toContain('s  run now')
    await press(stdin, 's')
    // Like a started draft, the run shows in the list rather than opening.
    await until(() => (lastFrame() ?? '').includes('Running triage'))
    const logged = await readFile(log, 'utf8')
    expect(logged).not.toContain('|attach')
    expect(logged).toContain('--bg --name ↻ triage')
    expect(logged).toContain('--model haiku')
    const { listRuns } = await import('../src/routines/index.ts')
    expect((await listRuns(home, 'triage'))[0]).toMatchObject({ status: 'started', id: 'abc12345' })
    done()
    unmount()
  })

  it('p moves a draft to another project before it starts', async () => {
    const { home, cfg, live } = await setup()
    const { lastFrame, stdin, unmount } = render(<App config={cfg} load={live} />)
    await tick()
    await press(stdin, '\t')
    await press(stdin, 'an idea')
    await press(stdin, '\u001b')
    await onList(lastFrame)
    await press(stdin, 'p')
    expect(lastFrame()).toContain('MOVE TO PROJECT')
    await press(stdin, 'con')
    await press(stdin, '\r')
    const { listDrafts } = await import('../src/drafts.ts')
    await until(async () => (await listDrafts(home))[0]?.project === 'kf/console')
    expect((await listDrafts(home))[0]?.project).toBe('kf/console')
    expect(lastFrame()).toContain('Moved to kf/console')
    done()
    unmount()
  })

  it('an untrusted folder says so and offers T, keeping the draft', async () => {
    const { home, cfg, live } = await setup({ untrusted: true })
    const { lastFrame, stdin, unmount } = render(<App config={cfg} load={live} />)
    await tick()
    await press(stdin, '\t')
    await press(stdin, 'hello')
    await press(stdin, '\u001b')
    await onList(lastFrame)
    await press(stdin, 's')
    await until(() => (lastFrame() ?? '').includes('T trusts it and starts'))
    expect(lastFrame()).toContain('T trusts it and starts')
    const { listDrafts } = await import('../src/drafts.ts')
    expect((await listDrafts(home)).map((d) => d.text)).toEqual(['hello'])
    done()
    unmount()
  })

  it('conversations opened stay open: moving onto one shows it live, without attaching again', async () => {
    const { cfg, projects, log } = await setup()
    const inbox = projects.find((p) => p.key === 'meta/inbox')!
    const snap: Snapshot = {
      ...snapshot,
      projects,
      items: toItems(
        [
          session({ name: 'First chat', id: 'aaa11111', cwd: inbox.path, state: 'done' }),
          session({ name: 'Second chat', id: 'bbb22222', cwd: inbox.path, state: 'done' }),
        ],
        projects,
      ),
    }
    const { lastFrame, stdin, unmount } = render(<App config={cfg} load={async () => snap} />)
    await tick()
    await press(stdin, 'n')
    const said = async (text: string) => {
      await press(stdin, text)
      await press(stdin, '\r')
      await until(() => (lastFrame() ?? '').includes(`you said: ${text}`))
    }
    // Open the selected one and say something, then step back; the same for the next row.
    await press(stdin, '\r')
    await until(() => (lastFrame() ?? '').includes('fake claude screen'))
    const first = /(First|Second) chat/.exec(lastFrame() ?? '')?.[0]
    await said('one')
    await press(stdin, '\u001d')
    await press(stdin, '\u001b[B')
    expect(lastFrame()).not.toContain('you said: one')
    await press(stdin, '\r')
    await until(() => !(lastFrame() ?? '').includes('you said: one'))
    await said('two')
    await press(stdin, '\u001d')
    // Back up: the first is still open and shows as it is, as does the second.
    await press(stdin, '\u001b[A')
    expect(lastFrame()).toContain('you said: one')
    expect(lastFrame()).toContain(first)
    expect(lastFrame()).not.toContain('you said: two')
    await press(stdin, '\u001b[B')
    expect(lastFrame()).toContain('you said: two')
    // ⏎ goes back into the one shown, not the one gone into last.
    await press(stdin, '\u001b[A')
    await press(stdin, '\r')
    await said('three')
    expect(lastFrame()).toContain('you said: one')
    const attaches = (await calls(log)).filter((c) => c.includes('|attach '))
    expect(attaches.map((c) => c.split('|attach ')[1]).sort()).toEqual(['aaa11111', 'bbb22222'])
    done()
    unmount()
  })

  it('d marks a finished conversation done, in Hopper’s own state', async () => {
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
    await press(stdin, 'd')
    await until(() => (lastFrame() ?? '').includes('Done: Backups chat'))
    expect(JSON.parse(await readFile(join(home, 'state', 'done.json'), 'utf8'))).toEqual({
      sessions: ['sess-1'],
    })
    done()
    unmount()
  })
})
