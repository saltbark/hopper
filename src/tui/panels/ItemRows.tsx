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

// The rows of a plain list, windowed around the selection. The mouse reads it too.
export const itemLines = (items: Item[], sel: number, height: number) =>
  windowed(items, sel, height - 2)

export const ItemRows = memo(function ItemRows(props: {
  items: Item[]
  sel: number
  // The row under the pointer: a lighter background than the selection's.
  hover?: number | null
  focused: boolean
  width: number
  height: number
  empty: string
  color: (account: string) => string
  // The done list: a quiet tick instead of the state, and the names step back.
  done?: boolean
}) {
  const { items, sel, hover, focused, width, height, empty, color, done } = props
  const w = width - 4
  if (!items.length) return <Text color={T.dim}>{' ' + empty}</Text>
  const { start, slice } = itemLines(items, sel, height)
  // Narrow panels drop the age column first, then squeeze the project column. Wide ones give
  // what's left to the name.
  const showAge = w >= 40
  const showModel = w >= 52
  // A routine's next run gets its own column once there's room; only lists with routines in
  // them give it up.
  const showNext = w >= 64 && items.some((it) => it.kind === 'routine')
  const whereW = Math.min(16, Math.max(10, Math.round(w * 0.28)))
  const nameW = Math.max(
    8,
    w - 2 - whereW - 4 - (showAge ? 5 : 0) - (showModel ? 7 : 0) - (showNext ? 7 : 0),
  )
  return (
    <>
      {slice.map((it, i) => {
        const isSel = start + i === sel
        const lit = isSel && focused
        const bg = lit ? T.sel : start + i === hover ? T.hover : undefined
        return (
          <Text key={it.account + it.sessionId} wrap="truncate-end">
            <Rail on={lit} bg={bg} />
            {done ? (
              <Text color={T.faint} backgroundColor={bg}>
                ✓
              </Text>
            ) : (
              <Mark
                state={it.unread ? 'unread' : it.held ? 'held' : it.state}
                kind={it.kind}
                {...(bg ? { bg } : {})}
              />
            )}
            <Text backgroundColor={bg}>
              {' '}
              <Text color={lit ? T.hi : done ? T.dim : T.text} bold={lit}>
                {cell(shortName(it), nameW)}
              </Text>
              <Text color={T.dim}>{cell(where(it), whereW)}</Text>
              <Text color={color(it.account)}>{cell(it.account, 4)}</Text>
              {showModel ? <Text color={T.faint}>{cell(it.model ?? '', 7)}</Text> : null}
              {showAge ? (
                <Text color={T.dim}>
                  {cell(
                    // Since it last moved: a conversation’s newest message, a routine’s last run.
                    it.kind === 'routine' && it.state === 'paused'
                      ? 'off'
                      : it.activeAt
                        ? ago(it.activeAt)
                        : '–',
                    5,
                    'right',
                  )}
                </Text>
              ) : null}
              {showNext ? (
                <Text color={T.faint}>
                  {cell(it.nextAt ? 'in ' + until(it.nextAt) : '', 7, 'right')}
                </Text>
              ) : null}
            </Text>
          </Text>
        )
      })}
    </>
  )
})
