// Builds the website into site/dist: the page, with the captured frames turned into rows of
// styled runs that the page draws on a canvas, the latest release's version written in (so the
// page never asks GitHub from the browser), and install.sh.
// Run pnpm site:capture first when the app's look has changed; frames.json is committed.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ansiToRows } from './ansi.ts'

const here = import.meta.dirname
const { columns, rows, frames } = JSON.parse(await readFile(join(here, 'frames.json'), 'utf8')) as {
  columns: number
  rows: number
  frames: Record<string, string>
}
const drawn = Object.fromEntries(Object.entries(frames).map(([id, f]) => [id, ansiToRows(f)]))
const listLength = Object.keys(frames).filter((id) => id.startsWith('list-')).length
// Inside a <script> element, so "</" must not appear as such.
const json = JSON.stringify({ columns, rows, listLength, frames: drawn }).replace(/<\//g, '<\\/')
// The release workflow names the tag it has just published (SITE_VERSION), since GitHub's latest
// can lag behind it; otherwise ask, with the workflow's token when there is one.
const token = process.env['GITHUB_TOKEN']
const latest =
  process.env['SITE_VERSION'] ||
  (await fetch('https://api.github.com/repos/saltbark/hopper/releases/latest', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ tag_name: string }>) : null))
    .then((r) => r?.tag_name ?? '')
    .catch(() => ''))
const page = (await readFile(join(here, 'index.html'), 'utf8'))
  .replace('/*FRAMES*/', () => json)
  .replace('__VERSION__', latest)
await mkdir(join(here, 'dist'), { recursive: true })
await writeFile(join(here, 'dist', 'index.html'), page)
await copyFile(join(here, 'frog.svg'), join(here, 'dist', 'frog.svg'))
await copyFile(join(here, 'install.sh'), join(here, 'dist', 'install.sh'))
// What a release copy of Hopper asks for to learn of a newer one (src/update.ts): the version, and
// its entry in CHANGELOG.md as plain lines, one per bullet.
if (latest) {
  const v = latest.replace(/^v/, '')
  const changelog = await readFile(join(here, '..', 'CHANGELOG.md'), 'utf8')
  const entry = changelog.split(/^## /m).find((s) => s.startsWith(`${v} `)) ?? ''
  const notes = entry
    .split('\n')
    .slice(1)
    .join('\n')
    .split(/^- /m)
    .map((b) => b.replace(/\s+/g, ' ').replace(/`/g, '').trim())
    .filter(Boolean)
  await writeFile(join(here, 'dist', 'latest.json'), JSON.stringify({ version: v, notes }) + '\n')
}
console.log(
  `site/dist/index.html: ${Object.keys(drawn).length} frames, ${Math.round(page.length / 1024)} KB, latest release ${latest || 'none'}`,
)
