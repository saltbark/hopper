// The relay between Hopper on the Mac and Hopper on the phone. One Durable Object per pairing (a
// room); each room holds at most one Mac socket and one phone socket and forwards every binary
// message from one to the other. It can't read them (they are sealed end to end, see
// src/remote/crypto.ts) and keeps nothing: no messages, no keys, no log of what passed.
//
// GET /v1/room/<room id>?role=mac|phone   upgrades to a WebSocket
//
// Its only words of its own are text frames: {"peer":"up"} when the other side is there (sent to
// both when the second arrives) and {"peer":"down"} when it leaves.
//
// Typed loosely on purpose: the Worker runtime's types aren't a dependency of the app, and this is
// small enough to read whole.

type Role = 'mac' | 'phone'

interface Socket {
  send(message: string | ArrayBuffer): void
  close(code?: number, reason?: string): void
  readyState: number
}

interface State {
  acceptWebSocket(ws: Socket, tags: string[]): void
  getWebSockets(tag?: string): Socket[]
  getTags(ws: Socket): string[]
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

const other = (role: Role): Role => (role === 'mac' ? 'phone' : 'mac')
const isRole = (s: string | null): s is Role => s === 'mac' || s === 'phone'

export class Room {
  constructor(private readonly state: State) {}

  private open(role: Role, except?: Socket): Socket[] {
    return this.state.getWebSockets(role).filter((ws) => ws !== except && ws.readyState === OPEN)
  }

  async fetch(req: Request): Promise<Response> {
    const role = new URL(req.url).searchParams.get('role')
    if (!isRole(role)) return new Response('role must be mac or phone', { status: 400 })
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('expected a WebSocket', { status: 426 })

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    // A new socket for a role replaces the old one: a phone that reconnects wins.
    for (const old of this.open(role)) old.close(4000, 'replaced')
    this.state.acceptWebSocket(server, [role])
    const peers = this.open(other(role))
    if (peers.length) {
      server.send(UP)
      for (const p of peers) p.send(UP)
    }
    return new Response(null, { status: 101, webSocket: client } as ResponseInit)
  }

  webSocketMessage(ws: Socket, message: string | ArrayBuffer): void {
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
    return env.ROOM.get(env.ROOM.idFromName(m[1]!)).fetch(req)
  },
}
