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

// A few of a project's open items, one line each. ◆ marks one something is working on, ● one
// the selected conversation is for.
export function OpenItems({
  items,
  max,
  width,
  taken,
  mine,
}: {
  items: OpenItem[]
  max: number
  width: number
  taken?: ReadonlySet<string> | undefined
  mine?: readonly string[] | undefined
}) {
  return (
    <>
      {items.slice(0, max).map((it, i) => (
        <Text key={i} wrap="truncate-end">
          {mine?.includes(it.title) ? (
            <Text color={T.focus}>{'● '}</Text>
          ) : taken?.has(it.title) ? (
            <Text color={T.running}>{'◆ '}</Text>
          ) : (
            <Text color={T.faint}>{'□ '}</Text>
          )}
          <Text color={T.text}>{it.title}</Text>
          {it.body ? <Text color={T.dim}>{' · ' + it.body}</Text> : null}
        </Text>
      ))}
      {items.length > max ? (
        <Text color={T.dim}>{cell(`… ${items.length - max} more · O shows them all`, width)}</Text>
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
