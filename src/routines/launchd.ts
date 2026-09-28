import { execFile } from 'node:child_process'
import { readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Routines and dispatch run inside the open app (autopilot.ts), not from launchd: with Hopper
// closed, nothing runs. Earlier versions put entries in ~/Library/LaunchAgents; this takes out
// any that are left, so a routine can't run behind the app's back.

const PREFIXES = ['com.saltbark.hopper.', 'com.saltbark.hopper-dispatch']

export async function removeLaunchd(): Promise<string[]> {
  const agents = process.env['HOPPER_LAUNCHD_DIR'] || join(homedir(), 'Library', 'LaunchAgents')
  const live = !process.env['HOPPER_NO_LAUNCHCTL']
  const uid = process.getuid?.() ?? 501
  const names = await readdir(agents).catch(() => [] as string[])
  const removed: string[] = []
  for (const n of names) {
    if (!n.endsWith('.plist') || !PREFIXES.some((p) => n.startsWith(p))) continue
    const path = join(agents, n)
    if (live)
      await new Promise<void>((resolve) =>
        execFile('launchctl', ['bootout', `gui/${uid}`, path], () => resolve()),
      )
    await rm(path, { force: true })
    removed.push(n.slice(0, -'.plist'.length))
  }
  return removed
}
