import { Text } from 'ink'

import type { Draft } from '../../../drafts.ts'
import { ago, wrapText } from '../../../format.ts'
import type { OpenItem } from '../../../items.ts'
import { OTHER, type Item } from '../../../model.ts'
import { tildify } from '../../../paths.ts'
import { draftKeys } from '../../keymap.ts'
import { modelLabel } from '../../state.ts'
import { stateMark, T } from '../../theme.ts'
import { Heading, Keys, Mark } from '../primitives.tsx'
import { OpenItems, row, stateWords, title } from './parts.tsx'

// A draft as it sits on the list: its settings, its keys, then its text, read only. ⏎ is the
// only way back into writing it.
export function DraftDetail({
  item,
  draft,
  width,
}: {
  item: Item
  draft?: Draft | undefined
  width: number
}) {
  const lines = wrapText(draft?.text ?? '', width)
  while (lines.length && !lines.at(-1)) lines.pop()
  return (
    <>
      {title(item.name)}
      <Text>
        <Mark state="draft" />
        <Text color={T.draft}> draft</Text>
        <Text color={T.dim}>{` · last edit ${ago(item.startedAt)} ago`}</Text>
      </Text>
      <Text> </Text>
      {row('project', item.key)}
      {row('model', modelLabel(draft?.model, draft?.effort))}
      <Text> </Text>
      <Keys keys={draftKeys(draft ?? {})} width={width} />
      <Text> </Text>
      <Heading label="text · ⏎ to keep writing" width={width} />
      {lines.map((l, i) => (
        <Text key={i} color={T.text}>
          {l || ' '}
        </Text>
      ))}
    </>
  )
}

export function ConversationDetail(props: {
  item: Item
  openItems?: OpenItem[] | null | undefined
  width: number
}) {
  const { item, openItems, width } = props
  const { color } = stateMark(item.state, item.kind)
  const inList = item.where !== 'done'
  return (
    <>
      {title(item.name)}
      <Text wrap="truncate-end">
        {inList ? <Mark state={item.state} kind={item.kind} /> : <Text color={T.faint}>✓</Text>}
        <Text color={inList ? color : T.dim}>{' ' + stateWords(item)}</Text>
        <Text color={T.dim}>{` · started ${ago(item.startedAt)} ago`}</Text>
      </Text>
      <Text> </Text>
      {row('project', item.key === OTHER ? 'none of Hopper’s projects' : item.key)}
      {row('cwd', tildify(item.cwd))}
      {row('login', `${item.account} · ${item.kind}`)}
      {row('model', [item.model ?? 'default', item.effort].filter(Boolean).join(' · '))}
      {item.routine ? row('routine', item.routine) : null}
      {item.result?.summary ? row('result', item.result.summary) : null}
      {item.id ? row('id', item.id) : null}
      <Text> </Text>
      {item.id ? (
        <Keys
          keys={
            inList
              ? [
                  ['⏎', 'open here'],
                  ['d', 'mark done'],
                  ['i', 'interrupt'],
                ]
              : [
                  ['⏎', 'open here'],
                  ['d', 'bring it back'],
                ]
          }
        />
      ) : (
        <Text color={T.dim}>Interactive session: switch to its terminal.</Text>
      )}
      {openItems?.length ? (
        <>
          <Text> </Text>
          <Heading label={`open in ${item.key}`} width={width} />
          <OpenItems items={openItems} max={8} width={width} />
        </>
      ) : null}
    </>
  )
}
