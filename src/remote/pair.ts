import { randomBytes } from 'node:crypto'

import { renderUnicodeCompact } from 'uqr'
import WebSocket from 'ws'

import { b64u } from './crypto.ts'
import { PING_MS } from './link.ts'
import { addPhone, loadIdentity, macName, relayUrl, remoteDir, type Phone } from './store.ts'
import {
  Kind,
  offerLink,
  pairedReply,
  readPairRequest,
  roomUrl,
  type Offer,
  type PairAsk,
} from './wire.ts'

// `hopper pair`: shows a QR code for the phone to scan, waits in a fresh room on the relay for the
// phone's request, checks it proves it saw this code, asks whether to let it in, and records it.
// The code holds a one-time secret and expires; the room becomes that phone's for good.

export const PAIR_TIMEOUT = 5 * 60_000

export type PairDeps = {
  print: (text: string) => void
  // Asks a yes-or-no question and resolves with the answer.
  confirm: (question: string) => Promise<boolean>
  relay?: string
  dir?: string
  timeout?: number
}

export async function pairPhone(deps: PairDeps): Promise<Phone | null> {
  const dir = deps.dir ?? remoteDir()
  const relay = deps.relay ?? relayUrl()
  const identity = await loadIdentity(dir)
  const offer: Offer = {
    relay,
    room: randomBytes(16),
    token: randomBytes(32),
    macPublic: identity.publicKey,
    secret: randomBytes(32),
    name: await macName(),
  }
  const link = offerLink(offer)
  deps.print(renderUnicodeCompact(link, { border: 2 }))
  deps.print(`Scan this with Hopper on your iPhone. It works once, for five minutes.\n${link}\n`)

  // The Mac is first into the room, so the relay keeps its token as the room's.
  const ws = new WebSocket(roomUrl(relay, b64u(offer.room), 'mac', b64u(offer.token)))
  ws.binaryType = 'arraybuffer'
  // Cloudflare drops a silent socket after about three minutes, sooner than the code expires.
  const pinger = setInterval(() => ws.readyState === WebSocket.OPEN && ws.ping(), PING_MS)
  try {
    const ask = await new Promise<PairAsk | null>((resolve, reject) => {
      const timer = setTimeout(() => resolve(null), deps.timeout ?? PAIR_TIMEOUT)
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error(`couldn't reach the relay at ${relay}`))
      }
      // The relay let go of the room before a phone came (it refused it, or dropped it).
      ws.onclose = (e) => {
        clearTimeout(timer)
        reject(new Error(`the relay closed the pairing room${e.reason ? ` (${e.reason})` : ''}`))
      }
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') return
        const data = Buffer.from(e.data as ArrayBuffer)
        // Only pairing requests matter here, and only until one is taken. A phone just paired
        // reconnects to this room at once and says hello, while this socket is still open; that
        // hello is for the app's bridge, not for us.
        if (data[0] !== Kind.pair) return
        const got = readPairRequest(data, offer, identity.privateKey)
        if (!got) return deps.print("A request came that didn't prove it saw this code; ignored.")
        clearTimeout(timer)
        ws.onmessage = null
        resolve(got)
      }
    })
    if (!ask) {
      deps.print('The code expired. Run hopper pair again for a new one.')
      return null
    }
    if (!(await deps.confirm(`Let "${ask.name}" in?`))) {
      deps.print('Not paired.')
      return null
    }
    const phone: Phone = {
      id: b64u(ask.phonePublic).slice(0, 12),
      name: ask.name,
      publicKey: b64u(ask.phonePublic),
      room: b64u(offer.room),
      token: b64u(offer.token),
      relay,
      pairedAt: Date.now(),
    }
    await addPhone(phone, dir)
    ws.send(pairedReply(ask.pairKey, offer.name))
    // Give the reply a moment to leave before the socket closes.
    await new Promise((r) => setTimeout(r, 500))
    deps.print(`Paired with ${ask.name}. It connects while Hopper is open.`)
    return phone
  } finally {
    clearInterval(pinger)
    ws.onclose = null
    ws.close()
  }
}
