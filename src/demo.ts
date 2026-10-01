import { appendFile, chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { addAccount, OVERNIGHT_DEFAULTS, setPrefixes, type Config } from './config.ts'
import { recordConversation } from './conversations.ts'
import { saveDraft } from './drafts.ts'
import { initHome } from './home.ts'
import { saveRoutine } from './routines/files.ts'
import { resultPath } from './routines/runs.ts'

// A made-up world for the website's screenshots: two logins (Blue Heron, Pinemoor), a handful of
// projects with open items, conversations in every state, drafts and routines. Everything lives
// under `dir`, and `claude` is a stand-in that answers from files there, so nothing real is read.
// Set HOPPER_CLAUDE to the returned `claude` before gathering, and HOME to `dir` so paths show as
// ~/hopper, ~/work/… rather than a temporary folder.

const MIN = 60_000
const HOUR = 60 * MIN

type Agent = {
  id: string
  name: string
  project: string
  state: string
  ago: number
  model?: string
  effort?: string
}

const PROJECTS: { key: string; open: string[] }[] = [
  {
    key: 'bh/atlas',
    open: [
      'Map tiles blur at zoom 14: suspect the retina path in `tiles.ts`.',
      'Offline mode: cache the last viewed region.',
      'Export a route as GPX.',
    ],
  },
  {
    key: 'bh/news/bulletin',
    open: [
      'Spring issue: three stories picked, one still to write.',
      'Unsubscribe link goes to a 404 on mobile.',
    ],
  },
  { key: 'bh/news/site', open: ['Archive page lists issues out of order.'] },
  {
    key: 'pm/tern',
    open: [
      'Sign-in with a magic link.',
      'Rate limit the public API.',
      'Move the job queue off cron.',
      'Billing page shows last month twice.',
    ],
  },
  { key: 'pm/lantern', open: ['Dark mode for the editor.', 'Search across notebooks.'] },
  { key: 'pm/lantern/apps/ledger', open: ['CSV import drops rows with quoted commas.'] },
]

const AGENTS: Record<'bh' | 'pm', Agent[]> = {
  bh: [
    {
      id: 'a1f3c0de',
      name: 'Fix the blurry tiles at zoom 14',
      project: 'bh/atlas',
      state: 'blocked',
      ago: 18 * MIN,
      model: 'opus',
    },
    {
      id: 'b27e9d41',
      name: 'Write the spring issue lead story',
      project: 'bh/news/bulletin',
      state: 'done',
      ago: 42 * MIN,
      model: 'sonnet',
    },
    {
      id: 'c3d81f22',
      name: 'Unsubscribe 404 on mobile',
      project: 'bh/news/bulletin',
      state: 'working',
      ago: 6 * MIN,
      model: 'sonnet',
      effort: 'low',
    },
    {
      id: 'd4a0b7e9',
      name: 'Sort the archive page by date',
      project: 'bh/news/site',
      state: 'done',
      ago: 5 * HOUR,
      model: 'haiku',
    },
  ],
  pm: [
    {
      id: 'e5c2a913',
      name: 'Magic link sign-in',
      project: 'pm/tern',
      state: 'working',
      ago: 25 * MIN,
      model: 'opus',
      effort: 'high',
    },
    {
      id: 'f6b4e0a7',
      name: 'Rate limit the public API',
      project: 'pm/tern',
      state: 'blocked',
      ago: 2 * HOUR,
      model: 'sonnet',
    },
    {
      id: '07d9c3b5',
      name: 'CSV import and quoted commas',
      project: 'pm/lantern/apps/ledger',
      state: 'working',
      ago: 11 * MIN,
      model: 'sonnet',
    },
    {
      id: '18e2f4c6',
      name: 'Billing page shows last month twice',
      project: 'pm/tern',
      state: 'done',
      ago: 3 * HOUR,
      model: 'sonnet',
    },
  ],
}

// Conversations already marked done, so Done has something in it.
const MARKED_DONE = ['d4a0b7e9', '18e2f4c6']

const CLAUDE = `#!/bin/sh
case "$1" in
  auth) cat "$CLAUDE_CONFIG_DIR/auth.json" ;;
  agents) cat "$CLAUDE_CONFIG_DIR/agents.json" ;;
  *) exit 0 ;;
esac
`

export async function makeDemo(
  dir: string,
  now = Date.now(),
): Promise<{ config: Config; claude: string }> {
  const home = join(dir, 'hopper')
  const work = join(dir, 'work')
  await initHome(home)

  const project = (key: string) => join(work, key.replace(/\//g, '-'))
  let toml = ''
  for (const p of PROJECTS) {
    const open = join(project(p.key), '_open.md')
    await mkdir(project(p.key), { recursive: true })
    const items = p.open.map((t) => `- [ ] ${t}`).join('\n')
    await writeFile(open, `# ${p.key}\n\n## Open\n${items}\n`)
    toml += `\n[[project]]\nkey = "${p.key}"\npath = "${project(p.key)}"\nopen_file = "${open}"\n`
  }
  await appendFile(join(home, 'projects.toml'), toml)

  const logins = [
    {
      name: 'bh' as const,
      label: 'Blue Heron',
      email: 'sam@blueheron.example',
      five: 34,
      week: 52,
    },
    { name: 'pm' as const, label: 'Pinemoor', email: 'sam@pinemoor.example', five: 12, week: 27 },
  ]
  let config: Config = {
    path: join(dir, 'config.toml'),
    accountsPath: join(dir, 'accounts.toml'),
    home,
    accounts: [],
    routes: [],
    overnight: OVERNIGHT_DEFAULTS,
  }
  for (const l of logins) {
    const configDir = join(dir, `.claude-${l.name}`)
    await mkdir(configDir, { recursive: true })
    config = addAccount(config, { name: l.name, label: l.label, configDir })
    await writeFile(
      join(configDir, 'auth.json'),
      JSON.stringify({ loggedIn: true, email: l.email, orgName: l.label, subscriptionType: 'max' }),
    )
    const resets = (h: number) => new Date(now + h * HOUR).toISOString()
    await writeFile(
      join(configDir, '.claude.json'),
      JSON.stringify({
        cachedUsageUtilization: {
          fetchedAtMs: now - 4 * MIN,
          utilization: {
            five_hour: { utilization: l.five, resets_at: resets(2.5) },
            seven_day: { utilization: l.week, resets_at: resets(70) },
          },
        },
      }),
    )
    const agents = AGENTS[l.name].map((a) => ({
      id: a.id,
      cwd: project(a.project),
      kind: 'background',
      startedAt: now - a.ago,
      sessionId: `${a.id}-demo`,
      name: a.name,
      state: a.state,
    }))
    await writeFile(join(configDir, 'agents.json'), JSON.stringify(agents))
    for (const a of AGENTS[l.name]) {
      await recordConversation(home, a.id, {
        project: a.project,
        startedAt: now - a.ago,
        ...(a.model ? { model: a.model } : {}),
        ...(a.effort ? { effort: a.effort } : {}),
      })
    }
  }
  config = setPrefixes(setPrefixes(config, 'bh', ['bh/']), 'pm', ['pm/', 'meta/'])

  await writeFile(
    join(home, 'state', 'done.json'),
    JSON.stringify({ sessions: MARKED_DONE.map((id) => `${id}-demo`) }),
  )

  await saveDraft(home, {
    id: 'demo-offline',
    project: 'bh/atlas',
    text: 'Offline mode: cache the last viewed region\n\nKeep the tiles for the region on screen when the app goes to the background, up to 50 MB.',
    created: now - 3 * HOUR,
    updated: now - 50 * MIN,
  })
  await saveDraft(home, {
    id: 'demo-queue',
    project: 'pm/tern',
    text: 'Move the job queue off cron\n\nUse the queue table we already have. Keep cron as a fallback for a week.',
    created: now - 2 * HOUR,
    updated: now - 2 * HOUR,
    queue: 'night',
    model: 'opus',
    done: 'Jobs run from the queue table; cron only as a fallback.',
  })
  await saveDraft(home, {
    id: 'demo-search',
    project: 'pm/lantern',
    text: 'Search across notebooks',
    created: now - 30 * MIN,
    updated: now - 30 * MIN,
    queue: 'now',
  })

  const brief = {
    name: 'daily-brief',
    project: 'meta/inbox',
    schedule: 'weekdays 7:00',
    model: 'sonnet',
    enabled: true,
    prompt: 'Read every open file and say what matters today.',
  }
  await saveRoutine(home, brief)
  await saveRoutine(home, {
    name: 'branch-review',
    project: 'pm/tern',
    schedule: 'daily 18:00',
    model: 'sonnet',
    effort: 'low',
    enabled: true,
    prompt: 'Look over branches with new commits today and note anything risky.',
  })
  await saveRoutine(home, {
    name: 'weekly-review',
    project: 'meta/inbox',
    schedule: 'weekly fri 16:00',
    model: 'opus',
    enabled: false,
    prompt: 'What moved this week, what stalled, and what to drop.',
  })
  const ran = new Date(now - 2 * HOUR)
  const report = resultPath(home, 'daily-brief', ran)
  await mkdir(join(report, '..'), { recursive: true })
  await writeFile(
    report,
    'Two things waiting on you, both small.\n\n## Waiting\n- **bh/atlas**: the tile fix needs a yes on dropping iOS 15.\n- **pm/tern**: rate limits, 60 or 120 a minute?\n\n## Running\n- Magic link sign-in, on Pinemoor.\n',
  )
  await appendFile(
    join(home, 'state', 'runs.jsonl'),
    JSON.stringify({
      routine: 'daily-brief',
      at: ran.getTime(),
      status: 'started',
      id: '29a8d1e3',
      account: 'pm',
      model: 'sonnet',
      result: report,
      prompt: 'demo',
    }) + '\n',
  )

  const bin = join(dir, '.bin')
  await mkdir(bin, { recursive: true })
  const claude = join(bin, 'claude')
  await writeFile(claude, CLAUDE)
  await chmod(claude, 0o755)
  return { config, claude }
}
