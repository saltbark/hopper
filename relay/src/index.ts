// The relay between Hopper on the Mac and Hopper on the phone. One Durable Object per pairing (a
// room); each room holds at most one Mac socket and one phone socket and forwards every binary
// message from one to the other. It can't read them (they are sealed end to end, see
// src/remote/crypto.ts) and keeps nothing of them: no messages, no keys, no log of what passed.
//
// GET /v1/room/<room id>?role=mac|phone&token=<room token>   upgrades to a WebSocket
//
// The room token comes in the pairing code, next to the room id; both sides show it on every
// connection. The room keeps a SHA-256 of the first token it sees (the Mac's, when `hopper pair`
// opens it) and closes any socket that shows another (4001), so knowing a room id alone (a
// screenshot of the link) no longer lets anyone push the real phone or Mac off. That hash is the
// one thing a room stores.
//
// The client is public, so the relay also guards its own bill: no token, no room (refused in the
// Worker, before it reaches a Durable Object); a message over MAX_BYTES closes its socket (4009);
// so does a socket sending more than PER_MINUTE messages in a minute (4029). Real use is far under
// both: the Mac's busiest is ~10 screen frames a second for a few seconds after a key, and its
// largest message a first screen or snapshot, tens of kilobytes.
//
// Its only words of its own are text frames: {"peer":"up"} when the other side is there (sent to
// both when the second arrives) and {"peer":"down"} when it leaves. Text from the sides is
// ignored (they only ever send binary).
//
// Typed loosely on purpose: the Worker runtime's types aren't a dependency of the app, and this is
// small enough to read whole.

import { MAX_BYTES, PER_MINUTE, REFUSED, TOO_BIG, TOO_MANY } from './limits.ts'

type Role = 'mac' | 'phone'

export interface Socket {
  send(message: string | ArrayBuffer): void
  close(code?: number, reason?: string): void
  accept?(): void
  readyState: number
}

export interface State {
  acceptWebSocket(ws: Socket, tags: string[]): void
  getWebSockets(tag?: string): Socket[]
  getTags(ws: Socket): string[]
  storage: {
    get(key: string): Promise<unknown>
    put(key: string, value: unknown): Promise<void>
  }
}

interface Namespace {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(req: Request): Promise<Response> }
}

declare const WebSocketPair: { new (): { 0: Socket; 1: Socket } }

const OPEN = 1
const UP = JSON.stringify({ peer: 'up' })
const DOWN = JSON.stringify({ peer: 'down' })
// 16 random bytes, base64url.
const ROOM = /^\/v1\/room\/([A-Za-z0-9_-]{22})$/
// 32 random bytes, base64url.
const TOKEN = /^[A-Za-z0-9_-]{43}$/

const other = (role: Role): Role => (role === 'mac' ? 'phone' : 'mac')
const isRole = (s: string | null | undefined): s is Role => s === 'mac' || s === 'phone'

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export class Room {
  // The room token's hash once read; undefined until then, null for a room no one has opened.
  private token: string | null | undefined
  // Messages each socket sent in its current minute. Kept in memory only: a room that hibernates
  // was quiet, so starting the count over loses nothing.
  private readonly counts = new WeakMap<Socket, { start: number; n: number }>()

  // The runtime makes it with (state, env); the clock is for tests.
  constructor(
    private readonly state: State,
    _env?: unknown,
    private readonly now = () => Date.now(),
  ) {}

  private open(role: Role, except?: Socket): Socket[] {
    return this.state.getWebSockets(role).filter((ws) => ws !== except && ws.readyState === OPEN)
  }

  // Whether a socket showing this token may use the room. The first token seen becomes the
  // room's for good.
  async admits(token: string): Promise<boolean> {
    if (!TOKEN.test(token)) return false
    const hash = await sha256(token)
    if (this.token === undefined) {
      const kept = await this.state.storage.get('token')
      this.token = typeof kept === 'string' ? kept : null
    }
    if (this.token === null) {
      await this.state.storage.put('token', hash)
      this.token = hash
      return true
    }
    return this.token === hash
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const role = url.searchParams.get('role')
    if (!isRole(role)) return new Response('role must be mac or phone', { status: 400 })
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('expected a WebSocket', { status: 426 })

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    if (await this.admits(url.searchParams.get('token') ?? '')) this.join(server, role)
    else {
      // Accepted only to say why, so the side can tell a refusal from a dropped line.
      server.accept?.()
      server.close(REFUSED, "not this room's token")
    }
    return new Response(null, { status: 101, webSocket: client } as ResponseInit)
  }

  join(server: Socket, role: Role) {
    // A new socket for a role replaces the old one: a phone that reconnects wins.
    for (const old of this.open(role)) old.close(4000, 'replaced')
    this.state.acceptWebSocket(server, [role])
    const peers = this.open(other(role))
    if (peers.length) {
      server.send(UP)
      for (const p of peers) p.send(UP)
    }
  }

  // Counts a message; true when the socket has gone over its minute's share.
  private over(ws: Socket): boolean {
    const t = this.now()
    let c = this.counts.get(ws)
    if (!c || t - c.start >= 60_000) {
      c = { start: t, n: 0 }
      this.counts.set(ws, c)
    }
    return ++c.n > PER_MINUTE
  }

  webSocketMessage(ws: Socket, message: string | ArrayBuffer): void {
    const size = typeof message === 'string' ? message.length : message.byteLength
    if (size > MAX_BYTES) return ws.close(TOO_BIG, 'message too big')
    if (this.over(ws)) return ws.close(TOO_MANY, 'too many messages')
    // Text is the relay's own; the sides only ever send binary.
    if (typeof message === 'string') return
    const role = this.state.getTags(ws)[0]
    if (!isRole(role)) return
    for (const p of this.open(other(role))) p.send(message)
  }

  webSocketClose(ws: Socket): void {
    const role = this.state.getTags(ws)[0]
    if (!isRole(role)) return
    // Replaced by a newer socket for the same role: the peer never saw it leave.
    if (this.open(role, ws).length) return
    for (const p of this.open(other(role))) p.send(DOWN)
  }

  webSocketError(ws: Socket): void {
    this.webSocketClose(ws)
  }
}

export default {
  async fetch(req: Request, env: { ROOM: Namespace }): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/') return new Response('Hopper relay\n')
    const m = ROOM.exec(url.pathname)
    if (!m) return new Response('not found', { status: 404 })
    // Refused here, before it reaches (and is billed to) a room.
    if (!TOKEN.test(url.searchParams.get('token') ?? ''))
      return new Response('a room token is needed: pair again', { status: 401 })
    return env.ROOM.get(env.ROOM.idFromName(m[1]!)).fetch(req)
  },
}
