import { Text } from 'ink'

import { wrapText } from '../../format.ts'
import type { OpenItem } from '../../items.ts'
import type { Item } from '../../model.ts'
import { type Line, markdownLines } from '../markdown.ts'
import { Frame, Heading, Mark } from '../panels/primitives.tsx'
import { groupOf, type ItemsView } from '../state.ts'
import { T } from '../theme.ts'

// A project's open items in full, in the right panel: each under its section, its title and
// all of its text, and what is working on it. Space picks items; tab starts a draft with them.

export type ItemLine =
  | { kind: 'section'; text: string }
  | { kind: 'title'; index: number; text: string; first: boolean }
  | { kind: 'body'; index: number; line: Line }
  | { kind: 'link'; index: number; item: Item }
  | { kind: 'gap' }

// The panel's inside, less its two header lines: the room the items scroll in.
const HEAD = 2
export const itemsRoom = (height: number) => Math.max(1, height - 2 - HEAD)
// Inside the frame's borders and padding, less the two cells the marks take.
const textWidth = (width: number) => Math.max(8, width - 4 - 2)

// The last layout, for the keys, the mouse and the render that follow one another.
let last:
  | { items: readonly OpenItem[]; links: readonly Item[][]; width: number; lines: ItemLine[] }
  | undefined

// Every line the panel can show, top to bottom. `links` is, for each item, what works on it.
export function openItemLines(items: readonly OpenItem[], links: readonly Item[][], width: number) {
  if (last && last.items === items && last.width === width && sameLinks(last.links, links))
    return last.lines
  const w = textWidth(width)
  const lines: ItemLine[] = []
  let section: string | undefined
  items.forEach((it, index) => {
    if (it.section !== section) {
      if (lines.length) lines.push({ kind: 'gap' })
      section = it.section
      if (section) lines.push({ kind: 'section', text: section })
    } else if (lines.length) lines.push({ kind: 'gap' })
    wrapText(it.title, w).forEach((text, i) =>
      lines.push({ kind: 'title', index, text, first: i === 0 }),
    )
    if (it.body.trim())
      for (const line of markdownLines(it.body, w)) lines.push({ kind: 'body', index, line })
    for (const item of links[index] ?? []) lines.push({ kind: 'link', index, item })
  })
  last = { items, links, width, lines }
  return lines
}

const sameLinks = (a: readonly Item[][], b: readonly Item[][]) =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i] ?? []
    return x.length === y.length && x.every((it, j) => it.sessionId === y[j]?.sessionId)
  })

// Where an item's lines start and end.
export function itemSpan(lines: ItemLine[], index: number): [number, number] {
  let from = -1
  let to = -1
  lines.forEach((l, i) => {
    if ('index' in l && l.index === index) {
      if (from < 0) from = i
      to = i
    }
  })
  return [Math.max(0, from), Math.max(0, to)]
}

// The first line shown, moved as little as it takes for the selected item to be in view: its
// title at least, and all of it when it fits. Its section's heading comes along when the item is
// the section's first.
export function follow(lines: ItemLine[], index: number, top: number, room: number): number {
  let [from, to] = itemSpan(lines, index)
  if (lines[from - 1]?.kind === 'section') from -= 1
  let t = top
  if (to - from + 1 > room) t = from
  else if (from < t) t = from
  else if (to >= t + room) t = to - room + 1
  return Math.max(0, Math.min(t, Math.max(0, lines.length - room)))
}

// The item on a line of the panel's inside (0 is its first line), or null for a heading or a gap.
export function itemAt(lines: ItemLine[], top: number, line: number): number | null {
  if (line < HEAD) return null
  const l = lines[top + line - HEAD]
  return l && 'index' in l ? l.index : null
}

// A draft or conversation on an item, in a few words.
const linkWords = (i: Item) => {
  if (i.kind === 'draft') return i.queue ? 'queued' : 'draft'
  const g = groupOf(i)
  return g === 'running' ? 'running' : g === 'held' ? 'on hold' : 'waiting on you'
}

export function ItemsPane(props: {
  view: ItemsView
  items: OpenItem[] | null | undefined
  links: Item[][]
  color: (account: string) => string
  width: number
  height: number
}) {
  const { view, items, links, color, width, height } = props
  const room = itemsRoom(height)
  const list = items ?? []
  const lines = openItemLines(list, links, width)
  const top = Math.max(0, Math.min(view.top, Math.max(0, lines.length - room)))
  const shown = lines.slice(top, top + room)
  const picked = new Set(view.picked)
  const below = lines.length - top - shown.length
  const meta = [
    `${list.length} open`,
    view.picked.length ? `${view.picked.length} picked` : '',
    lines.length > room ? (below ? `${below} more lines` : 'the end') : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const w = width - 4
  return (
    <Frame title="OPEN ITEMS" meta={meta} width={width} height={height} focused>
      <Text wrap="truncate-end">
        <Text bold color={T.hi}>
          {view.project}
        </Text>
        <Text color={T.dim}>
          {view.picked.length
            ? `  space picks · tab starts a draft with ${view.picked.length === 1 ? 'it' : 'them'}`
            : '  space picks items · tab starts a draft'}
        </Text>
      </Text>
      <Text> </Text>
      {items === undefined ? (
        <Text color={T.dim}>Reading…</Text>
      ) : items === null ? (
        <Text color={T.dim}>No open file.</Text>
      ) : !list.length ? (
        <Text color={T.dim}>No open items.</Text>
      ) : (
        shown.map((l, i) => {
          const key = top + i
          if (l.kind === 'gap') return <Text key={key}> </Text>
          if (l.kind === 'section') return <Heading key={key} label={l.text} width={w} />
          const it = list[l.index]!
          const sel = l.index === view.sel
          const bg = sel ? T.sel : undefined
          if (l.kind === 'title') {
            const on = picked.has(it.title)
            const taken = (links[l.index] ?? []).length > 0
            return (
              <Text key={key} wrap="truncate-end">
                <Text color={on ? T.focus : taken ? T.running : T.faint} backgroundColor={bg}>
                  {l.first ? (on ? '● ' : taken ? '◆ ' : '○ ') : '  '}
                </Text>
                <Text bold color={sel ? T.hi : T.text} backgroundColor={bg}>
                  {l.text}
                </Text>
              </Text>
            )
          }
          if (l.kind === 'link') {
            const i2 = l.item
            return (
              <Text key={key} wrap="truncate-end">
                <Text color={T.faint}>{'  ↳ '}</Text>
                <Mark state={i2.held ? 'held' : i2.state} kind={i2.kind} />
                <Text color={T.dim}>{` ${linkWords(i2)} · `}</Text>
                <Text color={T.text}>{i2.name}</Text>
                <Text color={color(i2.account)}>{' ' + i2.account}</Text>
              </Text>
            )
          }
          return (
            <Text key={key} wrap="truncate-end" color={T.dim}>
              {'  '}
              {l.line.length
                ? l.line.map((s, j) => (
                    <Text
                      key={j}
                      bold={s.bold}
                      italic={s.italic}
                      strikethrough={s.strike}
                      color={s.color ?? T.dim}
                    >
                      {s.text}
                    </Text>
                  ))
                : ' '}
            </Text>
          )
        })
      )}
    </Frame>
  )
}
