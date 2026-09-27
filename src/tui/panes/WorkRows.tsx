import { Text } from 'ink'
import { memo } from 'react'

import type { Item } from '../../model.ts'
import { ItemRows } from '../panels/ItemRows.tsx'
import { windowed } from '../panels/primitives.tsx'
import { GROUPS, groupOf, type Group } from '../state.ts'
import { T } from '../theme.ts'

const GROUP_COLOR: Record<Group, string> = {
  waiting: T.waiting,
  draft: T.draft,
  running: T.running,
  routines: T.focus,
  next: T.dim,
}

type Row = { gap: Group } | { header: Group; count: number } | { item: Item; index: number }

// The one list: items in their groups, a heading before each group with its count and the key
// that jumps to it, and a blank line between groups. The selection counts items only.
export const WorkRows = memo(function WorkRows(props: {
  items: Item[]
  sel: number
  focused: boolean
  width: number
  height: number
  color: (account: string) => string
}) {
  const { items, sel, focused, width, height, color } = props
  const counts = new Map<Group, number>()
  for (const it of items) counts.set(groupOf(it), (counts.get(groupOf(it)) ?? 0) + 1)
  const rows: Row[] = []
  items.forEach((item, index) => {
    const g = groupOf(item)
    if (index === 0 || groupOf(items[index - 1]!) !== g) {
      if (index > 0) rows.push({ gap: g })
      rows.push({ header: g, count: counts.get(g) ?? 0 })
    }
    rows.push({ item, index })
  })
  const selRow = Math.max(
    0,
    rows.findIndex((r) => 'item' in r && r.index === sel),
  )
  const { slice } = windowed(rows, selRow, height - 2)
  const w = width - 4
  return (
    <>
      {slice.map((r) => {
        if ('gap' in r) return <Text key={'g-' + r.gap}> </Text>
        if ('header' in r) {
          const g = GROUPS.find((x) => x.id === r.header)!
          const head = ` ${g.label.toUpperCase()} `
          const tail = `${r.count} (${g.key}) `
          return (
            <Text key={'h-' + r.header} wrap="truncate-end">
              <Text color={GROUP_COLOR[r.header]}>{head}</Text>
              <Text color={T.dim}>{`${r.count} `}</Text>
              <Text color={T.faint}>{`(${g.key}) `}</Text>
              <Text color={T.line}>
                {'─'.repeat(Math.max(0, w + 1 - head.length - tail.length))}
              </Text>
            </Text>
          )
        }
        return (
          <ItemRows
            key={r.item.account + r.item.sessionId}
            items={[r.item]}
            sel={r.index === sel ? 0 : -1}
            focused={focused}
            width={width}
            height={4}
            empty=""
            color={color}
          />
        )
      })}
    </>
  )
})
