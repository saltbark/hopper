import type { Snapshot } from '../model.ts'
import { ACTIONS, type Answer } from './actions.ts'
import type { KeyPair } from './crypto.ts'
import { Link } from './link.ts'
import { PhoneScreen, type Spawn, type Target } from './screen.ts'
import { loadIdentity, loadPhones, remoteDir, type Phone } from './store.ts'
import type { PhoneView } from './view.ts'

// The open app's side of the phones: one link per paired phone, each sent the newest view when
// it says hello and whenever the view changes, and the one conversation it has open, if any.
// Phones paired while the app is open are picked up on the next snapshot (`sync`), and an
// unpaired one is let go.
//
// From the phone: open {id, cols}, close {id}, keys {id, data}, paste {id, text},
// submit {id, text} (paste it, then Enter), resize {id, cols}, wheel {id, up}, reclaim {id},
// keep {} (still here). To it: snapshot, screen, closed.
// Actions (new, start, hold, done, routine) go to `onAction` (actions.ts), and its answer back.
//
// Every message the Mac sends is one the relay is billed for (an incoming message to its Durable
// Object; what it sends on to the phone is free), so the Mac sends only what the phone will show:
// nothing while no phone is there (`Link.send`), a snapshot when something on it changed but the
// ages alone at most every AGES_EVERY_MS, the screen paced (PACE in screen.ts), and nothing to a
// phone not heard from in LEASE_MS, whose connection died without closing.

// How long a phone may go without a word before the Mac stops sending to it. The phone says
// `keep` every 30 seconds when it has said nothing else.
export const LEASE_MS = 75_000

// Items' ages change on every poll while work runs; the phone shows them to the minute, so a
// snapshot that differs only in ages waits this long after the last one.
export const AGES_EVERY_MS = 30_000

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' ? v : NaN)

// A view as text, leaving out its time and, for `loose`, the items' ages.
const viewKey = (view: PhoneView, loose: boolean) =>
  JSON.stringify(view, (k, v: unknown) =>
    k === 'at' || (loose && k === 'activeAt') ? undefined : v,
  )

export class Bridge {
  private readonly links = new Map<string, Link>()
  private readonly screens = new Map<string, PhoneScreen>()
  private targets = new Map<string, Target>()
  private view: PhoneView | null = null
  private sent = { exact: '', loose: '', at: 0 }
  // When each phone was last heard from, and those that went quiet.
  private readonly heard = new Map<string, number>()
  private readonly quiet = new Set<string>()
  // Set by the app: does what the phone asked and says how it went.
  onAction: ((m: Record<string, unknown>) => Promise<Answer>) | null = null

  constructor(
    private readonly identity: KeyPair,
    private readonly dir = remoteDir(),
    private readonly spawn?: Spawn,
    private readonly now = () => Date.now(),
  ) {}

  static async open(dir = remoteDir()): Promise<Bridge> {
    return new Bridge(await loadIdentity(dir), dir)
  }

  get phones(): Phone[] {
    return [...this.links.values()].map((l) => l.phone)
  }

  get connected(): number {
    return [...this.links.values()].filter((l) => l.ready).length
  }

  async sync(): Promise<void> {
    const phones = await loadPhones(this.dir)
    const ids = new Set(phones.map((p) => p.id))
    for (const [id, link] of this.links)
      if (!ids.has(id)) {
        this.closeScreen(id)
        link.stop()
        this.links.delete(id)
      }
    for (const p of phones) {
      if (this.links.has(p.id)) continue
      const link: Link = new Link(p, this.identity, {
        ready: () => {
          // A new session: whatever the phone had open is gone with the old one.
          this.closeScreen(p.id)
          this.heard.set(p.id, this.now())
          this.quiet.delete(p.id)
          if (this.view) link.send(this.view)
        },
        message: (m) => this.receive(p.id, link, m),
        gone: () => this.closeScreen(p.id),
      })
      this.links.set(p.id, link)
      link.start()
    }
  }

  // A new snapshot. Sent only when what the phone sees has changed; the time alone doesn't
  // count, and the ages alone only every so often.
  update(view: PhoneView, snap?: Snapshot) {
    if (snap) this.targets = targetsOf(snap)
    this.view = view
    const exact = viewKey(view, false)
    if (exact === this.sent.exact) return
    const loose = viewKey(view, true)
    const at = this.now()
    if (loose === this.sent.loose && at - this.sent.at < AGES_EVERY_MS) return
    this.sent = { exact, loose, at }
    for (const [id, link] of this.links) this.sendTo(id, link, view)
  }

  // Sends to a phone that's still there. One not heard from in LEASE_MS has likely gone without
  // closing (out of signal, or asleep): its conversation stops sending until it speaks again.
  private sendTo(phone: string, link: Pick<Link, 'send'>, m: unknown): boolean {
    if (this.quiet.has(phone)) return false
    if (this.now() - (this.heard.get(phone) ?? 0) > LEASE_MS) {
      this.quiet.add(phone)
      this.screens.get(phone)?.pause()
      return false
    }
    return link.send(m)
  }

  receive(phone: string, link: Pick<Link, 'send'>, m: Record<string, unknown>) {
    this.heard.set(phone, this.now())
    if (this.quiet.delete(phone)) {
      // Back from quiet: it missed what changed meanwhile.
      if (this.view) link.send(this.view)
      this.screens.get(phone)?.resume()
    }
    const id = str(m['id'])
    const screen = this.screens.get(phone)
    const mine = screen && screen.id === id ? screen : null
    switch (m['t']) {
      case 'keep':
        return
      case 'open': {
        this.closeScreen(phone)
        const target = this.targets.get(id)
        if (!target) return void link.send({ t: 'closed', id, why: 'not open on the Mac' })
        this.screens.set(
          phone,
          new PhoneScreen(target, num(m['cols']), (f) => this.sendTo(phone, link, f), this.spawn),
        )
        return
      }
      case 'close':
        if (mine) this.closeScreen(phone)
        return
      case 'keys':
        return mine?.keys(str(m['data']))
      case 'paste':
        return mine?.paste(str(m['text']))
      case 'submit':
        return mine?.submit(str(m['text']))
      case 'resize':
        return mine?.resize(num(m['cols']))
      case 'wheel':
        return mine?.wheel(m['up'] === true)
      case 'reclaim':
        return mine?.reclaim()
    }
    if (typeof m['t'] === 'string' && ACTIONS.has(m['t']) && this.onAction) {
      void this.onAction(m).then(
        (a) => link.send(a),
        (e: Error) => link.send({ t: 'result', ref: m['ref'] ?? null, ok: false, text: e.message }),
      )
    }
  }

  private closeScreen(phone: string) {
    this.screens.get(phone)?.close()
    this.screens.delete(phone)
  }

  stop() {
    for (const s of this.screens.values()) s.close()
    this.screens.clear()
    for (const link of this.links.values()) link.stop()
    this.links.clear()
  }
}

// The conversations a phone may open: background sessions with an id that attach takes.
export function targetsOf(snap: Snapshot): Map<string, Target> {
  const accounts = new Map(snap.accounts.map((a) => [a.account.name, a.account]))
  const out = new Map<string, Target>()
  for (const i of snap.items) {
    const account = accounts.get(i.account)
    if (i.kind === 'background' && i.id && account)
      out.set(i.sessionId, { sessionId: i.sessionId, attachId: i.id, account, cwd: i.cwd })
  }
  return out
}
