import WebSocket from 'ws'

import { fromB64u, pairingKey, type KeyPair } from './crypto.ts'
import type { Phone } from './store.ts'
import { Kind, MacSession, PROTOCOL, roomUrl } from './wire.ts'

// The Mac's connection to one paired phone's room on the relay. It stays connected while Hopper
// is open, reconnecting with a growing wait when the relay drops it, and answers the phone's
// hello whenever the phone comes (or comes back). Messages go only once a session is up.

export type LinkEvents = {
  // A session started: the phone wants the current state.
  ready(): void
  message(m: Record<string, unknown>): void
  // The phone went (it left the relay, or the connection dropped): let go of what it had open.
  gone(): void
  // Something the owner should hear about this phone (`hopper phones`), or null once it's fine.
  trouble(note: string | null): void
}

const MAX_WAIT = 30_000

// The relay's own close codes (relay/src/index.ts).
export const REFUSED = 4001
export const TOO_BIG = 4009
export const TOO_MANY = 4029

// What to tell the owner about a phone on another protocol version.
export const versionNote = (theirs: number) =>
  theirs > PROTOCOL
    ? `the phone's app is newer (protocol ${theirs}): update Hopper on this Mac`
    : `the phone's app is older (protocol ${theirs}): update the app on it`

// Cloudflare drops a WebSocket that says nothing for about three minutes (seen: 191 s), and every
// reconnect is a billed request. A protocol ping is free, doesn't wake the relay's Durable Object,
// and keeps it open; one not answered by the next means the line is dead, so it's dropped and
// opened again rather than left hanging.
export const PING_MS = 60_000

export class Link {
  private ws: WebSocket | null = null
  private readonly session: MacSession
  private stopped = false
  private wait = 1000
  private timer: ReturnType<typeof setTimeout> | null = null
  private pinger: ReturnType<typeof setInterval> | null = null

  constructor(
    readonly phone: Phone,
    identity: KeyPair,
    private readonly on: LinkEvents,
  ) {
    this.session = new MacSession(
      pairingKey(identity.privateKey, fromB64u(phone.publicKey, 32), fromB64u(phone.room, 16)),
    )
  }

  get ready() {
    return this.session.ready && this.ws?.readyState === WebSocket.OPEN
  }

  start() {
    if (this.stopped || this.ws) return
    if (!this.phone.token) return this.on.trouble('paired before room tokens: pair it again')
    const ws = new WebSocket(roomUrl(this.phone.relay, this.phone.room, 'mac', this.phone.token))
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    let answered = true
    ws.on('pong', () => (answered = true))
    ws.onopen = () => {
      this.wait = 1000
      this.pinger = setInterval(() => {
        if (!answered) return ws.terminate()
        answered = false
        ws.ping()
      }, PING_MS)
    }
    ws.onmessage = (e) =>
      this.receive(typeof e.data === 'string' ? e.data : (e.data as ArrayBuffer))
    ws.onclose = (e) => {
      if (this.pinger) clearInterval(this.pinger)
      this.pinger = null
      this.ws = null
      this.session.end()
      this.on.gone()
      // Another token holds the room: trying again would be refused every time, and each try is
      // a billed request. It stays off until Hopper opens again.
      if (e.code === REFUSED) {
        this.stopped = true
        this.on.trouble('the relay refused its room: unpair it and pair again')
      }
      if (this.stopped) return
      this.timer = setTimeout(() => this.start(), this.wait)
      this.wait = Math.min(MAX_WAIT, this.wait * 2)
    }
    // An error is followed by close, which retries.
    ws.onerror = () => {}
  }

  private receive(data: string | ArrayBuffer) {
    if (typeof data === 'string') {
      // The relay's own news. The phone says hello when it sees the Mac; nothing to do on up.
      if (data.includes('"down"')) {
        this.session.end()
        this.on.gone()
      }
      return
    }
    const buf = Buffer.from(data)
    if (buf[0] === Kind.hello) {
      const reply = this.session.onHello(buf)
      if (!reply) return
      this.ws?.send(reply)
      if (this.session.mismatch !== null) return this.on.trouble(versionNote(this.session.mismatch))
      this.on.trouble(null)
      this.on.ready()
      return
    }
    const m = this.session.open(buf)
    if (m) this.on.message(m)
    // A frame that doesn't open ends the session; the phone says hello again.
    else if (!this.session.ready) this.on.gone()
  }

  send(message: unknown): boolean {
    if (!this.ready) return false
    this.ws!.send(this.session.seal(message))
    return true
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
    this.ws = null
  }
}
