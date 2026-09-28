import { execFile } from 'node:child_process'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Config } from '../config.ts'
import { readIfThere } from '../fsutil.ts'
import type { Routine } from './files.ts'
import { parseSchedule, type Slot } from './schedule.ts'

// macOS runs routines, so they run with Hopper closed and catch up after sleep. One entry per
// routine with a schedule, each calling `hopper run <name>`.

export const LABEL = 'com.saltbark.hopper.'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function plistFor(
  r: Routine,
  opts: { node: string; hopper: string; configPath: string; logDir: string; path: string },
): string | null {
  const slots = parseSchedule(r.schedule)
  if (typeof slots === 'string' || !slots.length || !r.enabled) return null
  const dict = (s: Slot) =>
    [
      '    <dict>',
      s.hour >= 0 ? `      <key>Hour</key><integer>${s.hour}</integer>` : '',
      `      <key>Minute</key><integer>${s.minute}</integer>`,
      s.weekday !== undefined ? `      <key>Weekday</key><integer>${s.weekday}</integer>` : '',
      s.day !== undefined ? `      <key>Day</key><integer>${s.day}</integer>` : '',
      '    </dict>',
    ]
      .filter(Boolean)
      .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}${esc(r.name)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(opts.node)}</string>
    <string>${esc(opts.hopper)}</string>
    <string>run</string>
    <string>${esc(r.name)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(opts.path)}</string>
    <key>HOPPER_CONFIG</key><string>${esc(opts.configPath)}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>
${slots.map(dict).join('\n')}
  </array>
  <key>StandardOutPath</key><string>${esc(join(opts.logDir, `${r.name}.log`))}</string>
  <key>StandardErrorPath</key><string>${esc(join(opts.logDir, `${r.name}.log`))}</string>
</dict>
</plist>
`
}

const launchctl = (args: string[]) =>
  new Promise<void>((resolve) => execFile('launchctl', args, () => resolve()))

// Makes ~/Library/LaunchAgents match the routine files: writes and reloads changed entries,
// removes ones whose routine is gone, paused or unscheduled. Returns what it changed.
export async function syncLaunchd(
  config: Config,
  routines: Routine[],
  opts: { hopper: string; node?: string },
): Promise<{ loaded: string[]; removed: string[] }> {
  const agents = process.env['HOPPER_LAUNCHD_DIR'] || join(homedir(), 'Library', 'LaunchAgents')
  const live = !process.env['HOPPER_NO_LAUNCHCTL']
  const uid = process.getuid?.() ?? 501
  const logDir = join(config.home, 'state', 'logs')
  await mkdir(agents, { recursive: true })
  await mkdir(logDir, { recursive: true })
  const loaded: string[] = []
  const removed: string[] = []
  const wanted = new Set<string>()
  for (const r of routines) {
    const xml = plistFor(r, {
      node: opts.node ?? process.execPath,
      hopper: opts.hopper,
      configPath: config.path,
      logDir,
      path: process.env['PATH'] ?? '/usr/bin:/bin',
    })
    if (!xml) continue
    const path = join(agents, `${LABEL}${r.name}.plist`)
    wanted.add(path)
    const current = (await readIfThere(path).catch(() => null)) ?? ''
    if (current === xml) continue
    await writeFile(path, xml)
    if (live) {
      await launchctl(['bootout', `gui/${uid}`, path])
      await launchctl(['bootstrap', `gui/${uid}`, path])
    }
    loaded.push(r.name)
  }
  for (const n of await readdir(agents)) {
    if (!n.startsWith(LABEL) || !n.endsWith('.plist')) continue
    const path = join(agents, n)
    if (wanted.has(path)) continue
    if (live) await launchctl(['bootout', `gui/${uid}`, path])
    await rm(path, { force: true })
    removed.push(n.slice(LABEL.length, -'.plist'.length))
  }
  return { loaded, removed }
}

// Whether launchd has a routine: its entry is loaded, written but not loaded, out of step with
// the file (stale), missing, or not wanted (paused or unscheduled).
export type LaunchdStatus = 'loaded' | 'not loaded' | 'stale' | 'missing' | 'unscheduled'

export async function launchdStatus(
  config: Config,
  r: Routine,
  opts: { hopper: string; node?: string },
): Promise<LaunchdStatus> {
  const agents = process.env['HOPPER_LAUNCHD_DIR'] || join(homedir(), 'Library', 'LaunchAgents')
  const want = plistFor(r, {
    node: opts.node ?? process.execPath,
    hopper: opts.hopper,
    configPath: config.path,
    logDir: join(config.home, 'state', 'logs'),
    path: process.env['PATH'] ?? '/usr/bin:/bin',
  })
  const have = await readIfThere(join(agents, `${LABEL}${r.name}.plist`)).catch(() => null)
  if (!want) return 'unscheduled'
  if (have === null) return 'missing'
  // PATH differs between a shell and launchd's own run; compare everything else.
  const strip = (x: string) => x.replace(/<key>PATH<\/key><string>[^<]*<\/string>/, '')
  if (strip(have) !== strip(want)) return 'stale'
  if (process.env['HOPPER_NO_LAUNCHCTL']) return 'loaded'
  const uid = process.getuid?.() ?? 501
  const ok = await new Promise<boolean>((resolve) =>
    execFile('launchctl', ['print', `gui/${uid}/${LABEL}${r.name}`], (err) => resolve(!err)),
  )
  return ok ? 'loaded' : 'not loaded'
}

// The dispatcher's own entry: `hopper dispatch` every ten minutes. Its label sits outside the
// routines' prefix, so syncLaunchd leaves it alone.
export const DISPATCH_LABEL = 'com.saltbark.hopper-dispatch'

export function dispatchPlist(opts: {
  node: string
  hopper: string
  configPath: string
  logDir: string
  path: string
  every?: number
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${DISPATCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(opts.node)}</string>
    <string>${esc(opts.hopper)}</string>
    <string>dispatch</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(opts.path)}</string>
    <key>HOPPER_CONFIG</key><string>${esc(opts.configPath)}</string>
  </dict>
  <key>StartInterval</key><integer>${opts.every ?? 600}</integer>
  <key>StandardOutPath</key><string>${esc(join(opts.logDir, 'dispatch.log'))}</string>
  <key>StandardErrorPath</key><string>${esc(join(opts.logDir, 'dispatch.log'))}</string>
</dict>
</plist>
`
}

// Installs or removes the dispatcher's entry. Returns the plist's path.
export async function setDispatchSchedule(
  config: Config,
  on: boolean,
  opts: { hopper: string; node?: string },
): Promise<string> {
  const agents = process.env['HOPPER_LAUNCHD_DIR'] || join(homedir(), 'Library', 'LaunchAgents')
  const live = !process.env['HOPPER_NO_LAUNCHCTL']
  const uid = process.getuid?.() ?? 501
  const path = join(agents, `${DISPATCH_LABEL}.plist`)
  if (live) await launchctl(['bootout', `gui/${uid}`, path])
  if (!on) {
    await rm(path, { force: true })
    return path
  }
  const logDir = join(config.home, 'state', 'logs')
  await mkdir(agents, { recursive: true })
  await mkdir(logDir, { recursive: true })
  await writeFile(
    path,
    dispatchPlist({
      node: opts.node ?? process.execPath,
      hopper: opts.hopper,
      configPath: config.path,
      logDir,
      path: process.env['PATH'] ?? '/usr/bin:/bin',
    }),
  )
  if (live) await launchctl(['bootstrap', `gui/${uid}`, path])
  return path
}
