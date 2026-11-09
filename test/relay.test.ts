import { describe, expect, it } from 'vitest'

import relay, { Room, type Socket, type State } from '../relay/src/index.ts'
import { MAX_BYTES, PER_MINUTE, REFUSED, TOO_BIG, TOO_MANY } from '../relay/src/limits.ts'
import {
  MAX_FRAME,
  REFUSED as LINK_REFUSED,
  TOO_BIG as LINK_TOO_BIG,
  TOO_MANY as LINK_TOO_MANY,
} from '../src/remote/link.ts'

// The relay's room, with the Durable Object's state and sockets faked: what it lets in, what it
// forwards, and when it closes a socket.

class FakeSocket implements Socket {
  readyState = 1
  sent: (string | ArrayBuffer)[] = []
  closed: [number?, string?] | null = null
  send(m: string | ArrayBuffer) {
    this.sent.push(m)
  }
  close(code?: number, reason?: string) {
    this.closed = [code, reason]
    this.readyState = 3
  }
}

function fakeState() {
  const sockets: { ws: Socket; tags: string[] }[] = []
  const stored = new Map<string, unknown>()
  const state: State = {
    acceptWebSocket: (ws, tags) => void sockets.push({ ws, tags }),
    getWebSockets: (tag) => sockets.filter((s) => !tag || s.tags.includes(tag)).map((s) => s.ws),
    getTags: (ws) => sockets.find((s) => s.ws === ws)?.tags ?? [],
    storage: {
      get: async (k) => stored.get(k),
      put: async (k, v) => void stored.set(k, v),
    },
  }
  return { state, stored }
}

const token = (c: string) => c.repeat(43)

describe('the relay', () => {
  it('keeps the first token a room sees, as a hash, and refuses any other', async () => {
    const { state, stored } = fakeState()
    const room = new Room(state)
    expect(await room.admits(token('a'))).toBe(true)
    expect(stored.get('token')).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.get('token')).not.toBe(token('a'))
    expect(await room.admits(token('a'))).toBe(true)
    expect(await room.admits(token('b'))).toBe(false)
    expect(await room.admits('')).toBe(false)
    // After the object wakes from hibernation, it reads the hash back.
    expect(await new Room(state).admits(token('b'))).toBe(false)
    expect(await new Room(state).admits(token('a'))).toBe(true)
  })

  it('forwards binary between the two sides and nothing of its own but up and down', () => {
    const { state } = fakeState()
    const room = new Room(state)
    const mac = new FakeSocket()
    const phone = new FakeSocket()
    room.join(mac, 'mac')
    room.join(phone, 'phone')
    expect(mac.sent).toEqual(['{"peer":"up"}'])
    const frame = new Uint8Array([4, 1, 2]).buffer
    room.webSocketMessage(phone, frame)
    expect(mac.sent[1]).toBe(frame)
    room.webSocketMessage(phone, 'text from a side')
    expect(mac.sent).toHaveLength(2)
  })

  it('closes a socket that sends too much, or too often', () => {
    let now = 0
    const { state } = fakeState()
    // Made as the runtime makes it, with the Worker's env second.
    const room = new Room(state, {}, () => now)
    const mac = new FakeSocket()
    const phone = new FakeSocket()
    room.join(mac, 'mac')
    room.join(phone, 'phone')
    room.webSocketMessage(phone, new ArrayBuffer(MAX_BYTES + 1))
    expect(phone.closed?.[0]).toBe(TOO_BIG)

    for (let i = 0; i < PER_MINUTE; i++) room.webSocketMessage(mac, new ArrayBuffer(8))
    expect(mac.closed).toBeNull()
    // A new minute starts the count over.
    now += 60_000
    for (let i = 0; i < PER_MINUTE; i++) room.webSocketMessage(mac, new ArrayBuffer(8))
    expect(mac.closed).toBeNull()
    room.webSocketMessage(mac, new ArrayBuffer(8))
    expect(mac.closed?.[0]).toBe(TOO_MANY)
  })

  it('turns away a room without a token before it reaches a Durable Object', async () => {
    let reached = false
    const env = {
      ROOM: {
        idFromName: (n: string) => n,
        get: () => ({
          fetch: async () => {
            reached = true
            return new Response('room')
          },
        }),
      },
    }
    const room = 'https://relay.example/v1/room/' + 'r'.repeat(22)
    expect((await relay.fetch(new Request(room + '?role=phone'), env)).status).toBe(401)
    expect(reached).toBe(false)
    await relay.fetch(new Request(`${room}?role=phone&token=${token('t')}`), env)
    expect(reached).toBe(true)
  })

  it('closes with the codes the Mac reads, at the size the Mac keeps under', () => {
    expect([REFUSED, TOO_BIG, TOO_MANY]).toEqual([LINK_REFUSED, LINK_TOO_BIG, LINK_TOO_MANY])
    expect(MAX_FRAME).toBe(MAX_BYTES)
  })
})
