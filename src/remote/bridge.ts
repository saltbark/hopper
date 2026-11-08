import type { KeyPair } from './crypto.ts'
import { Link } from './link.ts'
import { loadIdentity, loadPhones, remoteDir, type Phone } from './store.ts'
import type { PhoneView } from './view.ts'

// The open app's side of the phones: one link per paired phone, each sent the newest view when
// it says hello and whenever the view changes. Phones paired while the app is open are picked up
// on the next snapshot (`sync`), and an unpaired one is let go.

export class Bridge {
  private readonly links = new Map<string, Link>()
  private view: PhoneView | null = null
  private sent = ''

  constructor(
    private readonly identity: KeyPair,
    private readonly dir = remoteDir(),
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
        link.stop()
        this.links.delete(id)
      }
    for (const p of phones) {
      if (this.links.has(p.id)) continue
      const link = new Link(p, this.identity, {
        ready: () => this.view && link.send(this.view),
        message: () => {},
      })
      this.links.set(p.id, link)
      link.start()
    }
  }

  // A new snapshot. Sent only when what the phone sees has changed; the time alone doesn't count.
  update(view: PhoneView) {
    this.view = view
    const key = JSON.stringify({ ...view, at: 0 })
    if (key === this.sent) return
    this.sent = key
    for (const link of this.links.values()) link.send(view)
  }

  stop() {
    for (const link of this.links.values()) link.stop()
    this.links.clear()
  }
}
