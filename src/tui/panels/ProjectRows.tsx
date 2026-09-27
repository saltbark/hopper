import { Text } from 'ink'
import { memo } from 'react'

import { cell } from '../../format.ts'
import { inScope, OTHER } from '../../model.ts'
import type { TreeRow } from '../../tree.ts'
import { T } from '../theme.ts'
import { Rail, windowed } from './primitives.tsx'

// A selection lights up only in the list that has focus; elsewhere it waits unmarked, so the
// one bright row on screen is always the one the keys act on.

export const ProjectRows = memo(function ProjectRows(props: {
  rows: TreeRow[]
  sel: number
  focused: boolean
  scope: string | null
  width: number
  height: number
}) {
  const { rows, sel, focused, scope, width, height } = props
  const w = width - 4
  const numW = 13
  const { start, slice } = windowed(rows, sel, height - 3)
  const lit = (key: string) => !scope || inScope(key, scope) || inScope(scope, key)
  const count = (n: number, w: number, color: string) => (
    <Text color={n ? color : T.faint}>{cell(n ? String(n) : '·', w, 'right')}</Text>
  )
  return (
    <>
      <Text color={T.dim}>
        {' ' +
          cell('', w - numW) +
          cell('open', 5, 'right') +
          cell('run', 4, 'right') +
          cell('you', 4, 'right')}
      </Text>
      {slice.map((r, i) => {
        const isSel = start + i === sel
        const bg = isSel && focused ? T.sel : undefined
        const mark = r.hasChildren ? (r.folded ? '▸ ' : '▾ ') : '  '
        const name = r.key === OTHER ? 'elsewhere' : r.name
        return (
          <Text key={r.key} wrap="truncate-end">
            <Rail on={isSel && focused} bg={bg} />
            <Text backgroundColor={bg}>
              <Text color={T.faint}>{'  '.repeat(r.depth) + mark}</Text>
              <Text
                color={bg ? T.hi : !lit(r.key) || r.key === OTHER ? T.dim : T.text}
                bold={!!bg}
                italic={r.key === OTHER}
              >
                {cell(name, Math.max(1, w - numW - r.depth * 2 - 2))}
              </Text>
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
