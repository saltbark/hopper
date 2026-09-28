import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { render } from 'ink'

import { fetchAuth, runInteractive } from './claude.ts'
import {
  addAccount,
  setDefaultAccount,
  ConfigError,
  loadConfig,
  prefixesOf,
  saveAccounts,
  describePrefix,
  suggestName,
  writeDefaultConfig,
  type Config,
} from './config.ts'
import { ago, resetShort, when } from './format.ts'
import { initHome } from './home.ts'
import { gather, OTHER } from './model.ts'
import { configPath, tildify } from './paths.ts'
import { hopperPrompt } from './prompts.ts'
import { listRoutines, loadRoutine, nextRun, runRoutine, syncLaunchd } from './routines/index.ts'
import { App } from './tui/App.tsx'
import { MOUSE_OFF, MOUSE_ON } from './tui/mouse.ts'

const HELP = `hopper: toss work in the hopper, hop from item to item.

  hopper                 open the app
  hopper init            write the config and the home folder (never overwrites)
  hopper status [--json] what Hopper sees: logins, usage, sessions, projects
  hopper login <account> sign a login in (runs claude auth login for it)
  hopper run <routine>   run a routine once now (what the schedule calls)
  hopper routines [sync] list routines and when they next run; sync updates the schedule
  hopper help            this

Config: ${tildify(configPath())} (override with HOPPER_CONFIG)`

async function requireConfig(): Promise<Config> {
  const config = await loadConfig()
  if (!config) {
    console.error(`No config at ${tildify(configPath())}. Run: hopper init`)
    process.exit(1)
  }
  return config
}

async function init() {
  const path = configPath()
  const wrote = await writeDefaultConfig(path)
  console.log(wrote ? `wrote   ${tildify(path)}` : `kept    ${tildify(path)} (already there)`)
  const config = await requireConfig()
  const created = await initHome(config.home)
  console.log(`home    ${tildify(config.home)}`)
  for (const c of created) console.log(`  + ${c}`)
  if (!created.length) console.log('  (nothing new; existing files left alone)')

  // Start with whatever login Claude Code already uses. Everything else is added from the app.
  if (!config.accounts.length) {
    const probe = { name: 'probe', label: 'probe', configDir: null }
    const auth = await fetchAuth(probe).catch(() => null)
    if (auth?.loggedIn) {
      const name = suggestName(auth, [])
      const next = addAccount(config, {
        name,
        label: auth.orgName ?? auth.email ?? name,
        configDir: null,
      })
      // Your current login runs anything no route names, until you say otherwise.
      await saveAccounts(setDefaultAccount(next, name))
      console.log(
        `account ${name}: your current Claude login (${[auth.email, auth.orgName].filter(Boolean).join(' · ')})`,
      )
    } else {
      console.log('account none yet: Claude Code has no default login signed in')
    }
  } else {
    console.log(`accounts ${config.accounts.map((a) => a.name).join(', ')} (kept)`)
  }
  console.log(
    `\nNext: run hopper, press c for accounts. a adds another account, e sets the prefixes it runs.`,
  )
}

async function login(name: string | undefined) {
  const config = await requireConfig()
  const account = config.accounts.find((a) => a.name === name)
  if (!account) {
    console.error(`Name an account: ${config.accounts.map((a) => a.name).join(', ')}`)
    process.exit(1)
  }
  if (account.configDir) await mkdir(account.configDir, { recursive: true })
  console.log(
    `Signing in ${account.name} (${account.label}) · ${account.configDir ? tildify(account.configDir) : 'default login'}\n`,
  )
  process.exit(await runInteractive(account, ['auth', 'login']))
}

async function status(json: boolean) {
  const config = await requireConfig()
  const snap = await gather(config, null, true)
  if (json) {
    console.log(
      JSON.stringify({ ...snap, openCounts: Object.fromEntries(snap.openCounts) }, null, 2),
    )
    return
  }
  console.log(`config  ${tildify(config.path)}\nhome    ${tildify(config.home)}\n`)
  for (const a of snap.accounts) {
    const who = a.auth?.loggedIn
      ? [a.auth.email, a.auth.orgName, a.auth.subscriptionType].filter(Boolean).join(' · ')
      : 'not signed in'
    const runs = prefixesOf(config, a.account.name)
      .map((r) => describePrefix(r.prefix) + (r.rank ? ` (choice ${r.rank + 1})` : ''))
      .join(', ')
    console.log(
      `${a.account.name}  ${a.account.label} · ${a.account.configDir ? tildify(a.account.configDir) : 'default login'}`,
    )
    console.log(`    ${a.authError ? 'auth error: ' + a.authError : who}`)
    console.log(`    runs: ${runs || 'no prefixes yet'}`)
    if (a.usage) {
      const w = (label: string, x: typeof a.usage.fiveHour) =>
        x ? `${label} ${x.pct}% (${resetShort(x.resetsAt) || 'no reset time'})` : `${label} –`
      console.log(
        `    usage ${w('5h', a.usage.fiveHour)} · ${w('week', a.usage.sevenDay)} · cached ${ago(a.usage.fetchedAt)} ago`,
      )
    } else console.log('    usage: none cached')
    const c = a.counts
    console.log(
      `    sessions: ${a.sessionError ? 'error: ' + a.sessionError : `${c.queue} running, ${c.needs} need you, ${c.done} done, ${c.live} terminals`}`,
    )
  }
  console.log(`\nprojects${snap.projectsError ? ': ' + snap.projectsError : ''}`)
  for (const p of snap.projects) {
    const n = snap.openCounts.get(p.key)
    console.log(
      `    ${p.key.padEnd(24)} ${n === null || n === undefined ? 'no _open.md' : `${n} open`} · ${tildify(p.path)}`,
    )
  }
  const bg = snap.items.filter((i) => i.kind === 'background')
  console.log(`\nbackground sessions (${bg.length})`)
  for (const i of bg) {
    console.log(
      `    ${i.account.padEnd(3)} ${i.where.padEnd(6)} ${(i.id ?? '').padEnd(9)} ${i.state.padEnd(8)} ${(i.key === OTHER ? tildify(i.cwd) : i.key).padEnd(36)} ${i.name}`,
    )
  }
}

async function tui() {
  const config = await requireConfig()
  if (!process.stdout.isTTY) {
    console.error('hopper needs a terminal. For text output: hopper status')
    process.exit(1)
  }
  const app = render(<App config={config} />, {
    alternateScreen: true,
    exitOnCtrlC: true,
    // Redraw only the lines that changed; a full repaint per keystroke flickers.
    incrementalRendering: true,
  })
  // Real mouse events, so the wheel scrolls what's under it instead of sending arrow keys.
  process.stdout.write(MOUSE_ON)
  process.on('exit', () => process.stdout.write(MOUSE_OFF))
  try {
    await app.waitUntilExit()
  } finally {
    process.stdout.write(MOUSE_OFF)
  }
}

// The command launchd runs for a routine: this file's own bin/hopper.js.
export const hopperBin = () => fileURLToPath(new URL('../bin/hopper.js', import.meta.url))

// One run of a routine. launchd calls this on schedule; it skips (and says why) when every
// account for the routine's project is full or the previous run is still going.
async function run(name: string | undefined) {
  const config = await requireConfig()
  if (!name) {
    console.error('Name a routine: hopper run <routine>')
    process.exit(1)
  }
  const routine = await loadRoutine(config.home, name)
  if (!routine) {
    console.error(`No routine "${name}" in ${tildify(config.home)}/routines`)
    process.exit(1)
  }
  const snap = await gather(config, null, true)
  const out = await runRoutine({
    config,
    routine,
    projects: snap.projects,
    accounts: snap.accounts,
    sessions: snap.items,
    systemPrompt: hopperPrompt,
  })
  const at = new Date().toISOString()
  if (out.status === 'started') console.log(`${at} ${name}: started ${out.id} on ${out.account}`)
  else console.log(`${at} ${name}: skipped, ${out.reason}`)
}

async function routines(sub: string | undefined) {
  const config = await requireConfig()
  const all = await listRoutines(config.home)
  if (sub === 'sync') {
    const { loaded, removed } = await syncLaunchd(config, all, { hopper: hopperBin() })
    console.log(`schedule synced · ${loaded.length} updated · ${removed.length} removed`)
    return
  }
  if (!all.length) return console.log(`No routines yet in ${tildify(config.home)}/routines`)
  for (const r of all) {
    const next = r.enabled ? nextRun(r.schedule, new Date()) : null
    const status = !r.enabled ? 'paused' : next ? `next ${when(next.getTime())}` : 'run now only'
    console.log(
      `${r.name.padEnd(20)} ${(r.schedule || '–').padEnd(22)} ${r.project.padEnd(18)} ${(r.model ?? 'default').padEnd(8)} ${status}`,
    )
  }
}

const [cmd, ...rest] = process.argv.slice(2)
try {
  if (!cmd) await tui()
  else if (cmd === 'init') await init()
  else if (cmd === 'status') await status(rest.includes('--json'))
  else if (cmd === 'login') await login(rest[0])
  else if (cmd === 'run') await run(rest[0])
  else if (cmd === 'routines') await routines(rest[0])
  else if (cmd === 'help' || cmd === '--help' || cmd === '-h') console.log(HELP)
  else {
    console.error(`Unknown command "${cmd}".\n\n${HELP}`)
    process.exit(1)
  }
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message)
    process.exit(1)
  }
  throw e
}
