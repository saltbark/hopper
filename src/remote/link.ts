import WebSocket from 'ws'

import { fromB64u, pairingKey, type KeyPair } from './crypto.ts'
import type { Phone } from './store.ts'
import { Kind, MacSession } from './wire.ts'

// The Mac's connection to one paired phone's room on the relay. It stays connected while Hopper
// is open, reconnecting with a growing wait when the relay drops it, and answers the phone's
// hello whenever the phone comes (or comes back). Messages go only once a session is up.

export type LinkEvents = {
  // A session started: the phone wants the current state.
  ready(): void
  message(m: Record<string, unknown>): void
  // The phone went (it left the relay, or the connection dropped): let go of what it had open.
  gone(): void
}

const MAX_WAIT = 30_000

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
    const ws = new WebSocket(`${this.phone.relay}/v1/room/${this.phone.room}?role=mac`)
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
    ws.onclose = () => {
      if (this.pinger) clearInterval(this.pinger)
      this.pinger = null
      this.ws = null
      this.session.end()
      this.on.gone()
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
