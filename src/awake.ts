import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { inTurn, readIfThere, writeJson } from './fsutil.ts'

// Keeping the Mac awake while Hopper is open (z), so the night's work runs and a conversation can
// be reached from the phone. Off until turned on; then on, whatever Hopper is doing, until turned
// off. It is kept in <home>/state/awake.json, so a Hopper that restarts while I'm away comes back
// still holding the Mac awake. A closed lid still sleeps a laptop, unless it is plugged into a
// display; nothing here changes that.

const file = (home: string) => join(home, 'state', 'awake.json')

// Holds the Mac awake until the function it returns is called.
export type KeepAwake = () => () => void

// caffeinate -i stops idle sleep and lets the display sleep. -w quits it when Hopper does, even
// when Hopper doesn't get to stop it.
export const caffeinate: KeepAwake = () => {
  const child = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
  return () => void child.kill()
}

// Only macOS has caffeinate; elsewhere z does nothing and nothing shows.
export const canKeepAwake = process.platform === 'darwin'

// For showing: a file that can't be read is off.
export async function loadAwake(home: string): Promise<boolean> {
  try {
    const raw = JSON.parse((await readIfThere(file(home))) ?? '{}') as { on?: unknown }
    return raw.on === true
  } catch {
    return false
  }
}

export const saveAwake = (home: string, on: boolean) =>
  inTurn(file(home), () => writeJson(file(home), { on }))
