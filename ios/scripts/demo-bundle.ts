// What the app's built-in demo shows (ios/Hopper/Demo/): Hopper's made-up world (src/demo.ts)
// as the Mac's own code describes it to a phone, written once to ios/Hopper/Demo/demo.json. The
// app plays it back with no Mac and no relay, so someone without Hopper (App Review, first) can
// see every screen. Run it again when what the Mac sends changes:
//
//   npx tsx ios/scripts/demo-bundle.ts
//
// Nothing real is read: HOME and the claude it asks are the demo's own.

import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeDemo } from '../../src/demo.ts'
import { gather } from '../../src/model.ts'
import { act } from '../../src/remote/actions.ts'
import { phoneView } from '../../src/remote/view.ts'
import { accountColor } from '../../src/tui/panels/primitives.tsx'

const out = join(import.meta.dirname, '..', 'Hopper', 'Demo', 'demo.json')

const dir = await realpath(await mkdtemp(join(tmpdir(), 'hopper-demo-bundle-')))
process.env['HOME'] = dir
const { config, claude } = await makeDemo(dir)
process.env['HOPPER_CLAUDE'] = claude

const snap = await gather(config, null, true)
const view = phoneView(snap, 'Demo Mac', (name) => accountColor(config, name))
const deps = { config, snap, refresh: async () => {} }

const newinfo: Record<string, unknown> = {}
for (const p of view.projects) newinfo[p.key] = await act({ t: 'new', project: p.key }, deps)

const routineinfo: Record<string, unknown> = {}
const reports: Record<string, unknown> = {}
for (const r of view.items.filter((i) => i.kind === 'routine')) {
  const info = (await act({ t: 'routineinfo', id: r.id }, deps)) as {
    name: string
    reports: { file: string }[]
  }
  routineinfo[r.id] = info
  for (const rep of info.reports)
    reports[`${info.name}/${rep.file}`] = await act(
      { t: 'report', id: info.name, file: rep.file },
      deps,
    )
}

await writeFile(
  out,
  JSON.stringify({ snapshot: view, newinfo, routineinfo, reports }, null, 1) + '\n',
)
console.log(
  `${out}: ${view.items.length} items, ${Object.keys(newinfo).length} projects, ${Object.keys(reports).length} reports`,
)
