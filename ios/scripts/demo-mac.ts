// A Mac for the simulator to talk to: Hopper's made-up world (src/demo.ts: Blue Heron, Pinemoor,
// bh/atlas, pm/tern…), a real Bridge on the relay, and pairing that says yes by itself. It writes
// the pairing link to the file named on the command line and keeps running, sending a fresh
// snapshot every few seconds, until it's stopped.
//
//   npx tsx ios/scripts/demo-mac.ts /tmp/link.txt [relay]
//
// Nothing real is read: HOME and the claude it asks are the demo's own.

import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeDemo } from '../../src/demo.ts'
import { gather } from '../../src/model.ts'
import { act } from '../../src/remote/actions.ts'
import { Bridge } from '../../src/remote/bridge.ts'
import { pairPhone } from '../../src/remote/pair.ts'
import { loadIdentity } from '../../src/remote/store.ts'
import { phoneView } from '../../src/remote/view.ts'
import { accountColor } from '../../src/tui/panels/primitives.tsx'
import { demoSpawn } from './demo-screen.ts'

const [linkFile, relay = 'wss://hopper-relay.saltbark.com'] = process.argv.slice(2)
if (!linkFile) throw new Error('usage: demo-mac.ts <link file> [relay]')

const dir = await realpath(await mkdtemp(join(tmpdir(), 'hopper-sim-')))
process.env['HOME'] = dir
const { config, claude } = await makeDemo(dir)
process.env['HOPPER_CLAUDE'] = claude
const remote = join(dir, 'remote')

let snap = await gather(config, null, true)
const color = (name: string) => accountColor(config, name)

const paired = pairPhone({
  dir: remote,
  relay,
  name: 'Demo Mac',
  confirm: async () => true,
  print: (text) => {
    const link = /hopper:\/\/pair\S+/.exec(text)?.[0]
    if (link) void writeFile(linkFile, link)
    else if (!text.includes('█') && !text.includes('▀')) console.log(text)
  },
})
await paired

// Conversations open on a made-up Claude (demo-screen.ts): the demo's items have no real one.
const bridge = new Bridge(await loadIdentity(remote), remote, demoSpawn)
bridge.onAction = (m) =>
  act(m, {
    config,
    snap,
    refresh: async () => {
      snap = await gather(config, null, false)
      bridge.update(phoneView(snap, 'Demo Mac', color), snap)
    },
  })
await bridge.sync()
bridge.update(phoneView(snap, 'Demo Mac', color), snap)
console.log('bridge up')
setInterval(async () => {
  snap = await gather(config, null, false)
  bridge.update(phoneView(snap, 'Demo Mac', color), snap)
}, 4000)
