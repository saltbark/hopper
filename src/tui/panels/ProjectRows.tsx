import { Text } from 'ink'
import { memo } from 'react'

import type { ProjectRow } from '../../active.ts'
import { ago, cell } from '../../format.ts'
import { inScope } from '../../model.ts'
import { T } from '../theme.ts'
import { Rail, windowed } from './primitives.tsx'

// A selection lights up only in the list that has focus; elsewhere it waits unmarked, so the
// one bright row on screen is always the one the keys act on.

type Line = { header: true } | { row: ProjectRow; index: number }

// The panel's lines: the column heading, then the rows windowed around the selection. The mouse
// reads it too, to find the row under the pointer.
export function projectLines(rows: ProjectRow[], sel: number, height: number): Line[] {
  const { start, slice } = windowed(rows, sel, height - 3)
  return [{ header: true }, ...slice.map((row, i) => ({ row, index: start + i }))]
}

// By full key; a folder ends in /. Counts of nothing are left blank, so the ones that matter
// stand out.
export const ProjectRows = memo(function ProjectRows(props: {
  rows: ProjectRow[]
  sel: number
  // The row under the pointer: a lighter background than the selection's.
  hover: number | null
  focused: boolean
  // What's typed, while the panel is finding.
  query: string
  scope: string | null
  width: number
  height: number
}) {
  const { rows, sel, hover, focused, query, scope, width, height } = props
  const w = width - 4
  const numW = 13
  const ageW = 4
  if (!rows.length)
    return (
      <Text color={T.dim}>
        {query ? ' No project matches.' : ' Nothing going on. p, then type to find one.'}
      </Text>
    )
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
        const { row: r, index } = line
        const on = index === sel && focused
        const bg = on ? T.sel : index === hover ? T.hover : undefined
        const here = r.key === scope
        // Only the ones with nothing running or waiting say how long ago they were used.
        const age = !r.counts.run && !r.counts.you && r.last ? ago(r.last) : ''
        return (
          <Text key={r.key} wrap="truncate-end">
            <Rail on={on} bg={bg} />
            <Text backgroundColor={bg}>
              {'  '}
              <Text
                color={on ? T.hi : here ? T.focus : lit(r.key) ? T.text : T.dim}
                bold={on || here}
              >
                {cell(r.isProject ? r.key : r.key + '/', Math.max(1, w - numW - 2 - ageW))}
              </Text>
              <Text color={T.faint}>{cell(age, ageW, 'right')}</Text>
              {count(r.counts.open, 5, T.dim)}
              {count(r.counts.run, 4, T.running)}
              {count(r.counts.you, 4, T.waiting)}
            </Text>
          </Text>
        )
      })}
    </>
  )
})
