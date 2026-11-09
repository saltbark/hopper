import { execFile } from 'node:child_process'
import { chmod, mkdir } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { inTurn, readForChange, readIfThere, writeJson } from '../fsutil.ts'
import { b64u, fromB64u, newKeyPair, publicOf, type KeyPair } from './crypto.ts'

// The Mac's key for talking to phones, and the phones it has paired with. They live in
// ~/.hopper/remote/, readable only by this user, and not in Hopper's home folder: that may sync
// through Dropbox, and a private key shouldn't travel. HOPPER_REMOTE_DIR moves it (tests).

export const remoteDir = () =>
  process.env['HOPPER_REMOTE_DIR'] || join(homedir(), '.hopper', 'remote')

export const RELAY = 'wss://hopper-relay.saltbark.com'
export const relayUrl = () => process.env['HOPPER_RELAY'] || RELAY

export type Phone = {
  id: string
  name: string
  // base64url: its X25519 key, the room the two meet in, and the room's token, which both show
  // the relay. Phones paired before tokens (protocol 1) have none and must pair again.
  publicKey: string
  room: string
  token?: string
  relay: string
  pairedAt: number
}

// What the open app last found wrong with a phone's link (refused by the relay, on another
// version), for `hopper phones`, which runs apart from it.
export type PhoneStatus = Record<string, { note: string; at: number }>

const parseStatus = (text: string | null) => (text ? (JSON.parse(text) as PhoneStatus) : {})

export async function loadStatus(dir = remoteDir()): Promise<PhoneStatus> {
  try {
    return parseStatus(await readIfThere(join(dir, 'status.json')))
  } catch {
    return {}
  }
}

export async function setStatus(id: string, note: string | null, dir = remoteDir()) {
  const path = join(dir, 'status.json')
  await inTurn(path, async () => {
    const all = await readForChange(path, parseStatus)
    if ((all[id]?.note ?? null) === note) return
    if (note) all[id] = { note, at: Date.now() }
    else delete all[id]
    await ensureDir(dir)
    await writePrivate(path, all)
  })
}

async function writePrivate(path: string, value: unknown) {
  await writeJson(path, value)
  await chmod(path, 0o600)
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
}

// Made the first time it's asked for.
export async function loadIdentity(dir = remoteDir()): Promise<KeyPair> {
  const path = join(dir, 'identity.json')
  return inTurn(path, async () => {
    const text = await readIfThere(path)
    if (text) {
      const v = JSON.parse(text) as { privateKey: string }
      const privateKey = fromB64u(v.privateKey, 32)
      return { privateKey, publicKey: publicOf(privateKey) }
    }
    await ensureDir(dir)
    const k = newKeyPair()
    await writePrivate(path, { publicKey: b64u(k.publicKey), privateKey: b64u(k.privateKey) })
    return k
  })
}

const parsePhones = (text: string | null): Phone[] => (text ? (JSON.parse(text) as Phone[]) : [])

export async function loadPhones(dir = remoteDir()): Promise<Phone[]> {
  try {
    return parsePhones(await readIfThere(join(dir, 'phones.json')))
  } catch {
    return []
  }
}

export async function addPhone(phone: Phone, dir = remoteDir()) {
  const path = join(dir, 'phones.json')
  await inTurn(path, async () => {
    await ensureDir(dir)
    const all = await readForChange(path, parsePhones)
    await writePrivate(path, [...all.filter((p) => p.id !== phone.id), phone])
  })
}

export async function removePhone(id: string, dir = remoteDir()): Promise<boolean> {
  const path = join(dir, 'phones.json')
  return inTurn(path, async () => {
    const all = await readForChange(path, parsePhones)
    const kept = all.filter((p) => p.id !== id && p.name !== id)
    if (kept.length === all.length) return false
    await writePrivate(path, kept)
    return true
  })
}

// What the phone calls this Mac: its name in Sharing settings, else its host name.
let name: string | null = null
export async function macName(): Promise<string> {
  if (name) return name
  try {
    const { stdout } = await promisify(execFile)('scutil', ['--get', 'ComputerName'])
    name = stdout.trim() || hostname()
  } catch {
    name = hostname().replace(/\.local$/, '')
  }
  return name
}
