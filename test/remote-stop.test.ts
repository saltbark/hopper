import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { Bridge } from '../src/remote/bridge.ts'
import { b64u, newKeyPair } from '../src/remote/crypto.ts'
import { Link } from '../src/remote/link.ts'
import type { Phone } from '../src/remote/store.ts'

// Quitting Hopper stops every phone's link, and nothing of them may outlive it: whatever is left
// open keeps Node running after the screen has gone, until ctrl+c.

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

// A relay that opens the WebSocket and then never says anything again, a close included.
async function silentRelay() {
  const sockets: Socket[] = []
  const server = createServer((socket) => {
    sockets.push(socket)
    socket.once('data', (head) => {
      const key = /Sec-WebSocket-Key: (.+)\r\n/i.exec(head.toString())?.[1]?.trim() ?? ''
      const accept = createHash('sha1')
        .update(key + GUID)
        .digest('base64')
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      )
    })
    socket.on('error', () => {})
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as { port: number }
  return { url: `ws://127.0.0.1:${port}`, sockets, close: () => server.close() }
}

const phone = (relay: string): Phone => {
  const p = newKeyPair()
  return {
    id: 'p1',
    name: 'Test phone',
    publicKey: b64u(p.publicKey),
    room: b64u(Buffer.alloc(16, 7)),
    token: 'tok',
    relay,
    pairedAt: 0,
  }
}

const until = async (ok: () => boolean, ms = 2000) => {
  const t0 = Date.now()
  while (!ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20))
  return ok()
}

const quiet = { ready() {}, message() {}, gone() {}, trouble() {} }

describe('stopping the phone links', () => {
  let cleanup: (() => void)[] = []
  afterEach(() => {
    for (const c of cleanup) c()
    cleanup = []
  })

  it('lets go of the socket at once, even when the relay never answers the close', async () => {
    const relay = await silentRelay()
    cleanup.push(relay.close)
    const link = new Link(phone(relay.url), newKeyPair(), quiet)
    link.start()
    expect(await until(() => relay.sockets.length === 1)).toBe(true)
    await new Promise((r) => setTimeout(r, 100))
    const socket = relay.sockets[0]!
    let ended = false
    socket.on('close', () => (ended = true))
    link.stop()
    // A polite close waits up to 30 s for the relay's answer, holding Hopper open that long.
    expect(await until(() => ended, 1000)).toBe(true)
  })

  it('opens nothing for a phone list that was still loading when it stopped', async () => {
    const relay = await silentRelay()
    cleanup.push(relay.close)
    const dir = await mkdtemp(join(tmpdir(), 'hopper-remote-'))
    await writeFile(join(dir, 'phones.json'), JSON.stringify([phone(relay.url)]))
    const bridge = new Bridge(newKeyPair(), dir)
    const syncing = bridge.sync()
    bridge.stop()
    await syncing
    expect(bridge.phones).toEqual([])
    await new Promise((r) => setTimeout(r, 200))
    expect(relay.sockets.length).toBe(0)
  })
})
