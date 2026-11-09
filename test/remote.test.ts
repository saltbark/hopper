import { readFileSync } from 'node:fs'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Item, Snapshot } from '../src/model.ts'
import { Bridge, targetsOf } from '../src/remote/bridge.ts'
import {
  Channel,
  counterNonce,
  newKeyPair,
  openBox,
  pairingKey,
  pairProof,
  publicOf,
  sealBox,
  sessionKeys,
} from '../src/remote/crypto.ts'
import type { ScreenFrame, Spawn } from '../src/remote/screen.ts'
import { addPhone, loadIdentity, loadPhones, removePhone } from '../src/remote/store.ts'
import { phoneView } from '../src/remote/view.ts'
import {
  Kind,
  MacSession,
  offerLink,
  pairedReply,
  pairRequest,
  parseOffer,
  PhoneSession,
  readPairedReply,
  readPairRequest,
  type Offer,
} from '../src/remote/wire.ts'
import type { Seg } from '../src/tui/embed.ts'

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/remote-vectors.json'), 'utf8'),
) as { inputs: Record<string, string>; expect: Record<string, string> }
const h = (s: string) => Buffer.from(s, 'hex')
const hex = (b: Buffer) => b.toString('hex')

describe('remote crypto', () => {
  // The same vectors are checked against the app's CryptoKit code by ios/scripts/check-vectors.swift.
  it('matches the shared vectors', () => {
    const i = vectors.inputs as Record<string, string>
    const e = vectors.expect
    const macPublic = publicOf(h(i.macPrivate!))
    const phonePublic = publicOf(h(i.phonePrivate!))
    const macEph = publicOf(h(i.macEphPrivate!))
    const phoneEph = publicOf(h(i.phoneEphPrivate!))
    expect(hex(macPublic)).toBe(e.macPublic)
    expect(hex(phonePublic)).toBe(e.phonePublic)
    const pk = pairingKey(h(i.macPrivate!), phonePublic, h(i.room!))
    expect(hex(pk)).toBe(e.pairingKey)
    expect(hex(pairingKey(h(i.phonePrivate!), macPublic, h(i.room!)))).toBe(e.pairingKey)
    expect(hex(pairProof(h(i.secret!), h(i.room!), phonePublic))).toBe(e.proof)
    const sk = sessionKeys(h(i.macEphPrivate!), phoneEph, pk, macEph, phoneEph)
    expect(hex(sk.macToPhone)).toBe(e.macToPhone)
    expect(hex(sk.phoneToMac)).toBe(e.phoneToMac)
    expect(hex(sealBox(pk, h(i.plaintext!), h(i.aad!), h(i.nonce!)))).toBe(e.box)
    const ch = new Channel(sk.macToPhone, sk.phoneToMac)
    expect(hex(ch.seal(h(i.plaintext!)))).toBe(e.frame0)
    expect(hex(ch.seal(h(i.plaintext!)))).toBe(e.frame1)
    expect(hex(counterNonce(1n))).toBe(e.nonce1)
  })

  it('opens what it sealed, and nothing changed or under another label', () => {
    const key = newKeyPair().publicKey
    const box = sealBox(key, Buffer.from('hi'), Buffer.from('a'))
    expect(openBox(key, box, Buffer.from('a'))?.toString()).toBe('hi')
    expect(openBox(key, box, Buffer.from('b'))).toBeNull()
    const bent = Buffer.from(box)
    bent[14]! ^= 1
    expect(openBox(key, bent, Buffer.from('a'))).toBeNull()
  })

  it('refuses a frame out of order', () => {
    const a = newKeyPair().publicKey
    const b = newKeyPair().publicKey
    const tx = new Channel(a, b)
    const rx = new Channel(b, a)
    const f0 = tx.seal(Buffer.from('one'))
    const f1 = tx.seal(Buffer.from('two'))
    expect(rx.open(f1)).toBeNull()
    expect(rx.open(f0)?.toString()).toBe('one')
    expect(rx.open(f0)).toBeNull()
    expect(rx.open(f1)?.toString()).toBe('two')
  })
})

describe('pairing and sessions', () => {
  const mac = newKeyPair()
  const offer: Offer = {
    relay: 'wss://relay.example',
    room: Buffer.alloc(16, 9),
    macPublic: mac.publicKey,
    secret: Buffer.alloc(32, 7),
    name: "sam's MacBook Pro",
  }

  it('carries an offer through its link', () => {
    const back = parseOffer(offerLink(offer))
    expect(back.relay).toBe(offer.relay)
    expect(back.name).toBe(offer.name)
    expect(back.room.equals(offer.room)).toBe(true)
    expect(back.macPublic.equals(offer.macPublic)).toBe(true)
    expect(back.secret.equals(offer.secret)).toBe(true)
    expect(() => parseOffer('https://example.com/?v=1')).toThrow()
  })

  it('pairs a phone that saw the code, and no one else', () => {
    const phone = newKeyPair()
    const ask = readPairRequest(pairRequest(offer, phone, "Sam's iPhone"), offer, mac.privateKey)
    expect(ask?.name).toBe("Sam's iPhone")
    expect(ask?.phonePublic.equals(phone.publicKey)).toBe(true)

    // Someone who only knows the room (the relay) can't make the secret's proof.
    const guess = pairRequest({ ...offer, secret: Buffer.alloc(32, 1) }, newKeyPair(), 'x')
    expect(readPairRequest(guess, offer, mac.privateKey)).toBeNull()

    // Nor swap its own key into a real request.
    const real = pairRequest(offer, phone, "Sam's iPhone")
    const swapped = Buffer.from(real)
    newKeyPair().publicKey.copy(swapped, 1)
    expect(readPairRequest(swapped, offer, mac.privateKey)).toBeNull()

    const phoneKey = pairingKey(phone.privateKey, mac.publicKey, offer.room)
    expect(readPairedReply(pairedReply(ask!.pairKey, offer.name), phoneKey)?.name).toBe(offer.name)
  })

  it('starts a session from a hello and talks both ways', () => {
    const phone = newKeyPair()
    const key = pairingKey(mac.privateKey, phone.publicKey, offer.room)
    const m = new MacSession(key)
    const p = new PhoneSession(key)
    const reply = m.onHello(p.hello())
    expect(reply?.[0]).toBe(Kind.hello)
    expect(p.onHello(reply!)).toBe(true)
    expect(p.open(m.seal({ t: 'snapshot', n: 1 }))).toEqual({ t: 'snapshot', n: 1 })
    expect(m.open(p.seal({ t: 'open', id: 'a' }))).toEqual({ t: 'open', id: 'a' })
  })

  it('takes no hello from a stranger, and starts over on a new one', () => {
    const phone = newKeyPair()
    const key = pairingKey(mac.privateKey, phone.publicKey, offer.room)
    const m = new MacSession(key)
    const stranger = new PhoneSession(newKeyPair().publicKey)
    expect(m.onHello(stranger.hello())).toBeNull()
    expect(m.ready).toBe(false)

    const p = new PhoneSession(key)
    p.onHello(m.onHello(p.hello())!)
    const old = m.seal({ t: 'x' })
    // The phone reconnects: a new hello, a new session; frames from the old one don't open.
    p.onHello(m.onHello(p.hello())!)
    expect(p.open(old)).toBeNull()
    expect(p.open(m.seal({ t: 'y' }))).toEqual({ t: 'y' })
  })

  it("doesn't take its own hello reflected back", () => {
    const phone = newKeyPair()
    const key = pairingKey(mac.privateKey, phone.publicKey, offer.room)
    const m = new MacSession(key)
    const p = new PhoneSession(key)
    const reply = m.onHello(p.hello())!
    expect(m.onHello(reply)).toBeNull()
  })
})

describe('the phone view and the key store', () => {
  const item = (fields: Partial<Item>): Item => ({
    account: 'bh',
    id: 'a1',
    sessionId: 's1',
    kind: 'background',
    cwd: '/work/atlas',
    name: 'Fix the blurry tiles',
    startedAt: 1,
    state: 'working',
    where: 'queue',
    key: 'bh/atlas',
    activeAt: 1,
    ...fields,
  })
  const snapshot = (fields: Partial<Snapshot>): Snapshot => ({
    at: 5,
    drafts: [],
    routines: [],
    runs: [],
    reports: {},
    projects: [],
    projectsError: null,
    openCounts: new Map(),
    accounts: [],
    items: [],
    ...fields,
  })

  it('lists what the Mac lists, in its groups and order, and leaves out the rest', () => {
    const v = phoneView(
      snapshot({
        items: [
          item({ sessionId: 'run', name: 'Running one', activeAt: 3 }),
          item({ sessionId: 'ask', name: 'Asks', where: 'needs', state: 'blocked', activeAt: 2 }),
          item({ sessionId: 'old', name: 'Archived', where: 'done' }),
          item({ sessionId: 'held', name: 'Later', where: 'needs', held: true }),
        ],
        projects: [
          {
            key: 'bh/atlas',
            path: '/work/atlas',
            runIn: '/work/atlas',
            openFile: '/work/atlas/_open.md',
          },
        ],
        openCounts: new Map([['bh/atlas', 3]]),
      }),
      'test mac',
      () => '#7eaaea',
    )
    expect(v.items.map((i) => [i.id, i.group])).toEqual([
      ['run', 'running'],
      ['ask', 'waiting'],
      ['held', 'held'],
    ])
    expect(v.projects).toEqual([{ key: 'bh/atlas', open: 3, running: 1, waiting: 1 }])
    expect(v.mac).toBe('test mac')
    // Archived goes separately, so the phone can show it apart.
    expect(v.archived.map((i) => [i.id, i.group])).toEqual([['old', 'archived']])
  })

  it('keeps the Mac key private and remembers phones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hopper-remote-'))
    const a = await loadIdentity(dir)
    const b = await loadIdentity(dir)
    expect(a.publicKey.equals(b.publicKey)).toBe(true)
    expect((await stat(join(dir, 'identity.json'))).mode & 0o777).toBe(0o600)
    const phone = {
      id: 'p1',
      name: "Sam's iPhone",
      publicKey: 'k',
      room: 'r',
      relay: 'ws://x',
      pairedAt: 1,
    }
    await addPhone(phone, dir)
    await addPhone({ ...phone, name: 'renamed' }, dir)
    expect((await loadPhones(dir)).map((p) => p.name)).toEqual(['renamed'])
    expect(await removePhone('renamed', dir)).toBe(true)
    expect(await loadPhones(dir)).toEqual([])
  })
})

describe('a conversation open on the phone', () => {
  // A stand-in for `claude attach`: a screen the test writes, and what was sent to it.
  function fakeAttach() {
    const state = {
      rows: [
        [{ text: 'hello', fg: '#c7cfca' }],
        [{ text: '❯ ', fg: '#6fcac3', bold: true }],
      ] as Seg[][],
      sent: [] as string[],
      pasted: [] as string[],
      size: [0, 0],
      reclaimed: 0,
      closed: false,
      redraw: () => {},
      leave: () => {},
      cwd: '',
    }
    const spawn: Spawn = (_a, _id, _n, cols, rows, events) => {
      state.size = [cols, rows]
      state.leave = events.onLeave
      return {
        start: (cwd?: string) => void (state.cwd = cwd ?? ''),
        subscribe: (fn: () => void) => {
          state.redraw = fn
          return () => true
        },
        screen: () => state.rows,
        cursor: () => ({ col: 2, row: 1 }),
        send: (d: string) => void state.sent.push(d),
        paste: (t: string) => void state.pasted.push(t),
        resize: (c: number, r: number) => void (state.size = [c, r]),
        wheel: (up: boolean) => void state.sent.push(up ? 'PgUp' : 'PgDn'),
        close: () => void (state.closed = true),
        reclaim: () => void state.reclaimed++,
      }
    }
    return { state, spawn }
  }

  const account = { name: 'bh', label: 'Blue Heron', configDir: null }
  const snap = {
    at: 1,
    drafts: [],
    routines: [],
    runs: [],
    reports: {},
    projects: [],
    projectsError: null,
    openCounts: new Map(),
    accounts: [
      {
        account,
        auth: null,
        authError: null,
        usage: null,
        sessionError: null,
        sessions: [],
        sessionsAt: null,
        counts: { queue: 0, needs: 0, done: 0, live: 0 },
      },
    ],
    items: [
      {
        account: 'bh',
        id: 'a1f3c0de',
        sessionId: 'sess-1',
        kind: 'background',
        cwd: '/work/atlas',
        name: 'Fix the tiles',
        startedAt: 1,
        state: 'blocked',
        where: 'needs',
        key: 'bh/atlas',
        activeAt: 1,
      },
      {
        account: 'bh',
        id: null,
        sessionId: 'draft:x',
        kind: 'draft',
        cwd: '',
        name: 'A draft',
        startedAt: 1,
        state: 'draft',
        where: 'needs',
        key: 'bh/atlas',
        activeAt: 1,
      },
    ],
  } as Snapshot

  function open() {
    const { state, spawn } = fakeAttach()
    const bridge = new Bridge(newKeyPair(), '/nonexistent', spawn)
    bridge.update(
      phoneView(snap, 'mac', () => '#7eaaea'),
      snap,
    )
    const out: Record<string, unknown>[] = []
    const link = { send: (m: unknown) => (out.push(m as Record<string, unknown>), true) }
    bridge.receive('p1', link, { t: 'open', id: 'sess-1', cols: 48, rows: 30 })
    return { bridge, state, out, link }
  }

  it('only offers background conversations', () => {
    const v = phoneView(snap, 'mac', () => '#7eaaea')
    expect(v.items.map((i) => [i.id, i.attach ?? false])).toEqual([
      ['draft:x', false],
      ['sess-1', true],
    ])
    expect([...targetsOf(snap).keys()]).toEqual(['sess-1'])
  })

  it('attaches at the phone size in its folder, and sends only what changed', () => {
    const { state, out } = open()
    expect(state.size).toEqual([48, 30])
    expect(state.cwd).toBe('/work/atlas')
    state.redraw()
    const first = out.at(-1) as unknown as ScreenFrame
    expect(first.set).toEqual([
      [0, [['hello']]],
      [1, [['❯ ', '#6fcac3', '', 1]]],
    ])
    expect(first.cursor).toEqual([2, 1])
    state.rows = [state.rows[0]!, [{ text: '❯ hi', fg: '#c7cfca' }]]
    state.redraw()
    expect((out.at(-1) as unknown as ScreenFrame).set).toEqual([[1, [['❯ hi']]]])
  })

  it('passes keys, pastes, scrolling and size on to the conversation', () => {
    const { bridge, state, link } = open()
    bridge.receive('p1', link, { t: 'keys', id: 'sess-1', data: '1' })
    bridge.receive('p1', link, { t: 'paste', id: 'sess-1', text: 'two\nlines' })
    bridge.receive('p1', link, { t: 'wheel', id: 'sess-1', up: true })
    bridge.receive('p1', link, { t: 'resize', id: 'sess-1', cols: 60, rows: 40 })
    bridge.receive('p1', link, { t: 'reclaim', id: 'sess-1' })
    // Keys for some other conversation go nowhere.
    bridge.receive('p1', link, { t: 'keys', id: 'other', data: 'x' })
    expect(state.sent).toEqual(['1', 'PgUp'])
    expect(state.pasted).toEqual(['two\nlines'])
    expect(state.size).toEqual([60, 40])
    expect(state.reclaimed).toBe(1)
  })

  it("hands the phone's actions to the app and sends back the answer", async () => {
    const { bridge, out, link } = open()
    const asked: unknown[] = []
    bridge.onAction = async (m) => {
      asked.push(m)
      return { t: 'result', ref: m['ref'], ok: true, text: 'On hold: Fix the tiles' }
    }
    bridge.receive('p1', link, { t: 'hold', id: 'sess-1', ref: 7 })
    // Not an action: the bridge leaves it alone.
    bridge.receive('p1', link, { t: 'format-disk', ref: 8 })
    await new Promise((r) => setTimeout(r, 0))
    expect(asked).toEqual([{ t: 'hold', id: 'sess-1', ref: 7 }])
    expect(out.at(-1)).toEqual({ t: 'result', ref: 7, ok: true, text: 'On hold: Fix the tiles' })
  })

  it('says when it closes, refuses what it cannot open, and lets go when the phone does', () => {
    const { bridge, state, out, link } = open()
    state.leave()
    expect(out.at(-1)).toEqual({ t: 'closed', id: 'sess-1' })
    bridge.receive('p1', link, { t: 'open', id: 'draft:x', cols: 48, rows: 30 })
    expect(out.at(-1)).toMatchObject({ t: 'closed', id: 'draft:x' })

    const again = open()
    again.bridge.receive('p1', again.link, { t: 'close', id: 'sess-1' })
    expect(again.state.closed).toBe(true)
  })
})
