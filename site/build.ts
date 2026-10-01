// Builds the website into site/dist: the page, with the captured frames turned into HTML.
// Run pnpm site:capture first when the app's look has changed; frames.json is committed.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ansiToHtml } from './ansi.ts'

const here = import.meta.dirname
const { columns, rows, frames } = JSON.parse(await readFile(join(here, 'frames.json'), 'utf8')) as {
  columns: number
  rows: number
  frames: Record<string, string>
}
const html = Object.fromEntries(Object.entries(frames).map(([id, f]) => [id, ansiToHtml(f)]))
const listLength = Object.keys(frames).filter((id) => id.startsWith('list-')).length
// Inside a <script> element, so "</" must not appear as such.
const json = JSON.stringify({ columns, rows, listLength, frames: html }).replace(/<\//g, '<\\/')
const page = (await readFile(join(here, 'index.html'), 'utf8')).replace('/*FRAMES*/', () => json)
await mkdir(join(here, 'dist'), { recursive: true })
await writeFile(join(here, 'dist', 'index.html'), page)
console.log(
  `site/dist/index.html: ${Object.keys(html).length} frames, ${Math.round(page.length / 1024)} KB`,
)
