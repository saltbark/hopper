import { Text } from 'ink'

import { cell } from '../../../format.ts'
import type { OpenItem } from '../../../items.ts'
import type { Item } from '../../../model.ts'
import { T } from '../../theme.ts'

// Shared pieces of the right-hand panel.

// A label and its value on one line.
export const row = (label: string, value: string, color: string = T.text) => (
  <Text wrap="truncate-end">
    <Text color={T.dim}>{cell(label, 9)}</Text>
    <Text color={color}>{value}</Text>
  </Text>
)

export const title = (t: string) => (
  <Text bold color={T.hi} wrap="truncate-end">
    {t}
  </Text>
)

export function OpenItems({
  items,
  max,
  width,
}: {
  items: OpenItem[]
  max: number
  width: number
}) {
  return (
    <>
      {items.slice(0, max).map((it, i) => (
        <Text key={i} wrap="truncate-end">
          <Text color={T.faint}>{'□ '}</Text>
          <Text color={T.text}>{it.title}</Text>
          {it.body ? <Text color={T.dim}>{' · ' + it.body}</Text> : null}
        </Text>
      ))}
      {items.length > max ? (
        <Text color={T.dim}>{cell(`… ${items.length - max} more`, width)}</Text>
      ) : null}
    </>
  )
}

// What Claude's state means to Hopper, in words.
export const stateWords = (it: Item) =>
  it.where === 'done'
    ? 'archived'
    : it.held
      ? 'on hold: you know about it'
      : it.state === 'done'
        ? 'answered, waiting on you'
        : it.state

// The right panel's title names what it is showing.
export function detailTitle(item: Item | undefined, project: unknown, account: unknown): string {
  if (account) return 'ACCOUNT'
  if (project) return 'PROJECT'
  if (item?.kind === 'draft') return 'DRAFT'
  if (item?.kind === 'routine') return 'ROUTINE'
  return item ? 'CONVERSATION' : 'SELECTED'
}
