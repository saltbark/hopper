import { spawn } from 'node:child_process'

import type { Item } from './model.ts'

// A sound when a conversation stops running and waits on me. config.toml's `sound` is one of
// macOS's system sounds, "bell" for the terminal's own, or "off".
export const DEFAULT_SOUND = 'Glass'
export const SOUNDS = [
  'Glass',
  'Ping',
  'Pop',
  'Tink',
  'Hero',
  'Submarine',
  'Purr',
  'Funk',
  'bell',
  'off',
] as const

export type Chime = (sound: string) => void

// The conversations that were running last time and wait on me now, other than the one on screen.
// The first look (prev null) says nothing: everything already waiting was waiting before Hopper.
// A routine's new report doesn't: its row's dot says it.
export function newlyWaiting(prev: Item[] | null, next: Item[], onScreen: string | null): Item[] {
  if (!prev) return []
  const running = new Set(prev.filter((i) => i.where === 'queue').map((i) => i.sessionId))
  return next.filter(
    (i) => i.where === 'needs' && running.has(i.sessionId) && i.sessionId !== onScreen,
  )
}

export const playChime: Chime = (sound) => {
  if (sound === 'off') return
  if (sound === 'bell') return void process.stdout.write('\x07')
  const child = spawn('afplay', [`/System/Library/Sounds/${sound}.aiff`], {
    stdio: 'ignore',
    detached: true,
  })
  child.on('error', () => {})
  child.unref()
}
