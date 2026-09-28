import { Text } from 'ink'
import { memo } from 'react'

import { ago, cell, until } from '../../format.ts'
import type { Item } from '../../model.ts'
import { T } from '../theme.ts'
import { Mark, Rail, where, windowed } from './primitives.tsx'

// Claude often names a conversation "<project> · <what it's about>". The project has its own
// column, so the name leaves it off.
export function shortName(it: Item): string {
  const lead = where(it) + ' · '
  return it.name.startsWith(lead) && it.name.length > lead.length
    ? it.name.slice(lead.length)
    : it.name
}

export const ItemRows = memo(function ItemRows(props: {
  items: Item[]
  sel: number
  focused: boolean
  width: number
  height: number
  empty: string
  color: (account: string) => string
  // The done list: a quiet tick instead of the state, and the names step back.
  done?: boolean
}) {
  const { items, sel, focused, width, height, empty, color, done } = props
  const w = width - 4
  if (!items.length) return <Text color={T.dim}>{' ' + empty}</Text>
  const { start, slice } = windowed(items, sel, height - 2)
  // Narrow panels drop the age column first, then squeeze the project column. Wide ones give
  // what's left to the name.
  const showAge = w >= 40
  const showModel = w >= 52
  const whereW = Math.min(16, Math.max(10, Math.round(w * 0.28)))
  const nameW = Math.max(8, w - 2 - whereW - 4 - (showAge ? 5 : 0) - (showModel ? 7 : 0))
  return (
    <>
      {slice.map((it, i) => {
        const isSel = start + i === sel
        const bg = isSel && focused ? T.sel : undefined
        return (
          <Text key={it.account + it.sessionId} wrap="truncate-end">
            <Rail on={isSel && focused} bg={bg} />
            {done ? (
              <Text color={T.faint} backgroundColor={bg}>
                ✓
              </Text>
            ) : (
              <Mark state={it.state} kind={it.kind} {...(bg ? { bg } : {})} />
            )}
            <Text backgroundColor={bg}>
              {' '}
              <Text color={bg ? T.hi : done ? T.dim : T.text} bold={!!bg}>
                {cell(shortName(it), nameW)}
              </Text>
              <Text color={T.dim}>{cell(where(it), whereW)}</Text>
              <Text color={color(it.account)}>{cell(it.account, 4)}</Text>
              {showModel ? <Text color={T.faint}>{cell(it.model ?? '', 7)}</Text> : null}
              {showAge ? (
                <Text color={T.dim}>
                  {cell(
                    it.kind === 'routine'
                      ? it.startedAt
                        ? until(it.startedAt)
                        : it.state === 'paused'
                          ? 'off'
                          : '–'
                      : ago(it.startedAt),
                    5,
                    'right',
                  )}
                </Text>
              ) : null}
            </Text>
          </Text>
        )
      })}
    </>
  )
})
