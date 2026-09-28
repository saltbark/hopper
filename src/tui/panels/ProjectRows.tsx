import { Text } from 'ink'
import { memo } from 'react'

import { ago, cell } from '../../format.ts'
import { inScope, OTHER } from '../../model.ts'
import type { TreeRow } from '../../tree.ts'
import { T } from '../theme.ts'
import { Rail, windowed } from './primitives.tsx'

// A selection lights up only in the list that has focus; elsewhere it waits unmarked, so the
// one bright row on screen is always the one the keys act on.

type Line = { header: true } | { rule: true } | { row: TreeRow; index: number }

// The panel's lines: the column heading, then the rows windowed around the selection, with a
// rule where the active projects end and the tree begins. The mouse reads it too, to find the
// row under the pointer.
export function projectLines(rows: TreeRow[], sel: number, height: number): Line[] {
  const hasActive = rows.some((r) => r.active)
  const { start, slice } = windowed(rows, sel, height - 3 - (hasActive ? 1 : 0))
  const lines: Line[] = [{ header: true }]
  slice.forEach((row, i) => {
    const index = start + i
    if (!row.active && index > 0 && rows[index - 1]?.active) lines.push({ rule: true })
    lines.push({ row, index })
  })
  return lines
}

// The columns of a tree row's fold mark (▸ ▾), counted from the panel's left border: the rail,
// then two columns a level.
export const foldMarkAt = (row: TreeRow) => 2 + row.depth * 2

// The projects with something going on come first, by full key (activeRows), then a rule, then
// the tree. Counts of nothing are left blank, so the ones that matter stand out.
export const ProjectRows = memo(function ProjectRows(props: {
  rows: TreeRow[]
  sel: number
  // The row under the pointer: a lighter background than the selection's.
  hover: number | null
  focused: boolean
  scope: string | null
  width: number
  height: number
}) {
  const { rows, sel, hover, focused, scope, width, height } = props
  const w = width - 4
  const numW = 13
  const ageW = 4
  const lit = (key: string) => !scope || inScope(key, scope) || inScope(scope, key)
  const count = (n: number, w: number, color: string) => (
    <Text color={color}>{cell(n ? String(n) : '', w, 'right')}</Text>
  )
  return (
    <>
      {projectLines(rows, sel, height).map((line) => {
        if ('header' in line)
          return (
            <Text key="header" color={T.dim}>
              {' ' +
                cell('', w - numW) +
                cell('open', 5, 'right') +
                cell('run', 4, 'right') +
                cell('you', 4, 'right')}
            </Text>
          )
        if ('rule' in line)
          return (
            <Text key="rule" wrap="truncate-end">
              <Text color={T.faint}>{'  all '}</Text>
              <Text color={T.line}>{'─'.repeat(Math.max(0, w - 5))}</Text>
            </Text>
          )
        const { row: r, index } = line
        const on = index === sel && focused
        const bg = on ? T.sel : index === hover ? T.hover : undefined
        const counts = (
          <>
            {count(r.counts.open, 5, T.dim)}
            {count(r.counts.run, 4, T.running)}
            {count(r.counts.you, 4, T.waiting)}
          </>
        )
        if (r.active) {
          const here = r.key === scope
          // Only the ones here because they were used lately say how long ago.
          const age = !r.counts.run && !r.counts.you && r.last ? ago(r.last) : ''
          return (
            <Text key={'active:' + r.key} wrap="truncate-end">
              <Rail on={on} bg={bg} />
              <Text backgroundColor={bg}>
                {'  '}
                <Text
                  color={on ? T.hi : here ? T.focus : lit(r.key) ? T.text : T.dim}
                  bold={on || here}
                >
                  {cell(r.name, Math.max(1, w - numW - 2 - ageW))}
                </Text>
                <Text color={T.faint}>{cell(age, ageW, 'right')}</Text>
                {counts}
              </Text>
            </Text>
          )
        }
        const mark = r.hasChildren ? (r.folded ? '▸ ' : '▾ ') : '  '
        const name = r.key === OTHER ? 'elsewhere' : r.name
        return (
          <Text key={r.key} wrap="truncate-end">
            <Rail on={on} bg={bg} />
            <Text backgroundColor={bg}>
              <Text color={T.faint}>{'  '.repeat(r.depth) + mark}</Text>
              <Text
                color={on ? T.hi : !lit(r.key) || r.key === OTHER ? T.dim : T.text}
                bold={on}
                italic={r.key === OTHER}
              >
                {cell(name, Math.max(1, w - numW - r.depth * 2 - 2))}
              </Text>
              {counts}
            </Text>
          </Text>
        )
      })}
    </>
  )
})
