import { randomBytes } from 'node:crypto'

import {
  b64u,
  Channel,
  fromB64u,
  newKeyPair,
  openBox,
  pairingKey,
  pairProof,
  proofMatches,
  sealBox,
  sessionKeys,
  type KeyPair,
} from './crypto.ts'

// What goes over the relay: binary WebSocket messages, the first byte saying which kind. The
// relay's own messages are text (`{"peer":"up"}`), never binary, so the two can't be confused.
//
//   PAIR    phone → Mac  phone key (32) · proof (32) · box under the pairing key: {v, name}
//   PAIRED  Mac → phone  box under the pairing key: {v, name}
//   HELLO   either       box under the pairing key: {v, id, eph}; the phone asks, the Mac answers
//   DATA    either       a frame under this connection's key: JSON
//
// A hello from a phone on a version the Mac doesn't speak gets an answer with no `eph`: {v, id,
// oldest}, the versions the Mac speaks, so the phone can say which side to update. Both sides
// come from separate updates (the App Store, Hopper's own), so this is how they find out.
//
// The app has the same in `ios/Hopper/Remote/Wire.swift`.

// 2: the pairing link carries a room token, which both sides show the relay on connecting.
export const PROTOCOL = 2
// The oldest phone the Mac still answers. Raise PROTOCOL without raising this when a change
// leaves older phones working. Version 1 had no room token, and the relay refuses those rooms.
export const OLDEST = 2

// What a hello's `v` says about the other side.
export type Versions = { v: number; oldest: number }
export const versionsMatch = (theirs: number) => theirs >= OLDEST && theirs <= PROTOCOL

export const Kind = { pair: 1, paired: 2, hello: 3, data: 4 } as const

const AAD = {
  pair: Buffer.from('hopper pair request v1'),
  paired: Buffer.from('hopper paired v1'),
  helloPhone: Buffer.from('hopper hello v1 phone'),
  helloMac: Buffer.from('hopper hello v1 mac'),
}

const frame = (kind: number, body: Buffer) => Buffer.concat([Buffer.from([kind]), body])
const json = (v: unknown) => Buffer.from(JSON.stringify(v))

function parse(b: Buffer | null): Record<string, unknown> | null {
  if (!b) return null
  try {
    const v: unknown = JSON.parse(b.toString('utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// What a QR code carries. The room token is the room's for good: both sides present it to the
// relay on every connection, and the relay lets in only the token it saw first (relay/).
export type Offer = {
  relay: string
  room: Buffer
  token: Buffer
  macPublic: Buffer
  secret: Buffer
  name: string
}

export function offerLink(o: Offer): string {
  const q = new URLSearchParams({
    v: String(PROTOCOL),
    r: o.relay,
    room: b64u(o.room),
    t: b64u(o.token),
    k: b64u(o.macPublic),
    s: b64u(o.secret),
    n: o.name,
  })
  return `hopper://pair?${q}`
}

export function parseOffer(link: string): Offer {
  const u = new URL(link)
  if (u.protocol !== 'hopper:' || u.host !== 'pair') throw new Error('not a Hopper pairing link')
  const p = u.searchParams
  if (p.get('v') !== String(PROTOCOL)) throw new Error('a pairing link from another version')
  return {
    relay: p.get('r') ?? '',
    room: fromB64u(p.get('room') ?? '', 16),
    token: fromB64u(p.get('t') ?? '', 32),
    macPublic: fromB64u(p.get('k') ?? '', 32),
    secret: fromB64u(p.get('s') ?? '', 32),
    name: p.get('n') ?? '',
  }
}

// Where a side connects: its room on the relay, as `role`, showing the room's token.
export const roomUrl = (relay: string, room: string, role: 'mac' | 'phone', token: string) =>
  `${relay}/v1/room/${room}?role=${role}&token=${token}`

// The phone's request to pair. Here for the tests and as the reference for the Swift side.
export function pairRequest(offer: Offer, phone: KeyPair, name: string): Buffer {
  const key = pairingKey(phone.privateKey, offer.macPublic, offer.room)
  return frame(
    Kind.pair,
    Buffer.concat([
      phone.publicKey,
      pairProof(offer.secret, offer.room, phone.publicKey),
      sealBox(key, json({ v: PROTOCOL, name }), AAD.pair),
    ]),
  )
}

export type PairAsk = { phonePublic: Buffer; name: string; pairKey: Buffer }

// The Mac's side of a request: null unless it proves it saw this QR code and opens under the key.
export function readPairRequest(data: Buffer, offer: Offer, macPrivate: Buffer): PairAsk | null {
  if (data[0] !== Kind.pair || data.length < 1 + 64 + 28) return null
  const phonePublic = data.subarray(1, 33)
  const proof = data.subarray(33, 65)
  if (!proofMatches(offer.secret, offer.room, phonePublic, proof)) return null
  const pairKey = pairingKey(macPrivate, phonePublic, offer.room)
  const body = parse(openBox(pairKey, data.subarray(65), AAD.pair))
  if (!body || typeof body.name !== 'string') return null
  return { phonePublic: Buffer.from(phonePublic), name: body.name.slice(0, 80), pairKey }
}

export const pairedReply = (pairKey: Buffer, macName: string) =>
  frame(Kind.paired, sealBox(pairKey, json({ v: PROTOCOL, name: macName }), AAD.paired))

export function readPairedReply(data: Buffer, pairKey: Buffer): { name: string } | null {
  if (data[0] !== Kind.paired) return null
  const body = parse(openBox(pairKey, data.subarray(1), AAD.paired))
  return body && typeof body.name === 'string' ? { name: body.name } : null
}

// The Mac's end of a connection. A hello from the phone starts a new session (a phone that
// reconnects says hello again); the Mac answers with its own fresh key, and from then on frames
// go under the session's keys.
// The Mac's answer to a hello. Without `eph` it says only which versions the Mac speaks.
export const macHello = (pairKey: Buffer, body: Record<string, unknown>, nonce?: Buffer) =>
  frame(Kind.hello, sealBox(pairKey, json(body), AAD.helloMac, nonce))

export class MacSession {
  private channel: Channel | null = null
  // The version the phone's last hello was on, when it's one the Mac doesn't speak.
  mismatch: number | null = null
  constructor(private readonly pairKey: Buffer) {}

  get ready() {
    return this.channel !== null
  }

  // The reply to send, or null when the frame isn't a hello from this phone. A phone on another
  // version is told which versions the Mac speaks, and no session starts.
  onHello(data: Buffer, eph: KeyPair = newKeyPair()): Buffer | null {
    if (data[0] !== Kind.hello) return null
    const body = parse(openBox(this.pairKey, data.subarray(1), AAD.helloPhone))
    if (!body || typeof body.id !== 'string' || body.id.length > 64) return null
    const v = typeof body.v === 'number' ? body.v : 0
    if (!versionsMatch(v)) {
      this.channel = null
      this.mismatch = v
      return macHello(this.pairKey, { v: PROTOCOL, oldest: OLDEST, id: body.id })
    }
    if (typeof body.eph !== 'string') return null
    let phoneEph: Buffer
    try {
      phoneEph = fromB64u(body.eph, 32)
    } catch {
      return null
    }
    this.mismatch = null
    const keys = sessionKeys(eph.privateKey, phoneEph, this.pairKey, eph.publicKey, phoneEph)
    this.channel = new Channel(keys.macToPhone, keys.phoneToMac)
    return macHello(this.pairKey, {
      v: PROTOCOL,
      oldest: OLDEST,
      id: body.id,
      eph: b64u(eph.publicKey),
    })
  }

  seal(message: unknown): Buffer {
    if (!this.channel) throw new Error('no session yet')
    return frame(Kind.data, this.channel.seal(json(message)))
  }

  // A message from the phone, or null when it doesn't open: the session is then over, and the
  // phone has to say hello again.
  open(data: Buffer): Record<string, unknown> | null {
    if (data[0] !== Kind.data || !this.channel) return null
    const out = parse(this.channel.open(data.subarray(1)))
    if (!out) this.channel = null
    return out
  }

  end() {
    this.channel = null
  }
}

// The phone's end, for the tests (the app has its own, in Swift).
export class PhoneSession {
  private channel: Channel | null = null
  private pending: { id: string; eph: KeyPair } | null = null
  // The Mac's versions, when it answered that it doesn't speak this one.
  mismatch: Versions | null = null
  constructor(
    private readonly pairKey: Buffer,
    private readonly version = PROTOCOL,
  ) {}

  get ready() {
    return this.channel !== null
  }

  hello(eph: KeyPair = newKeyPair(), id = b64u(randomBytes(8))): Buffer {
    this.pending = { id, eph }
    this.channel = null
    return frame(
      Kind.hello,
      sealBox(
        this.pairKey,
        json({ v: this.version, id, eph: b64u(eph.publicKey) }),
        AAD.helloPhone,
      ),
    )
  }

  onHello(data: Buffer): boolean {
    if (data[0] !== Kind.hello || !this.pending) return false
    const body = parse(openBox(this.pairKey, data.subarray(1), AAD.helloMac))
    if (!body || body.id !== this.pending.id) return false
    if (typeof body.eph !== 'string') {
      if (typeof body.v === 'number')
        this.mismatch = {
          v: body.v,
          oldest: typeof body.oldest === 'number' ? body.oldest : body.v,
        }
      return false
    }
    const macEph = fromB64u(body.eph, 32)
    const { eph } = this.pending
    const keys = sessionKeys(eph.privateKey, macEph, this.pairKey, macEph, eph.publicKey)
    this.channel = new Channel(keys.phoneToMac, keys.macToPhone)
    this.pending = null
    return true
  }

  seal(message: unknown): Buffer {
    if (!this.channel) throw new Error('no session yet')
    return frame(Kind.data, this.channel.seal(json(message)))
  }

  open(data: Buffer): Record<string, unknown> | null {
    if (data[0] !== Kind.data || !this.channel) return null
    return parse(this.channel.open(data.subarray(1)))
  }
}
