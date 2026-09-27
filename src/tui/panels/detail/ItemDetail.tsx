import { Text } from 'ink'

import type { Draft } from '../../../drafts.ts'
import { ago, wrapText } from '../../../format.ts'
import type { OpenItem } from '../../../items.ts'
import { OTHER, type Item } from '../../../model.ts'
import { tildify } from '../../../paths.ts'
import { stateMark, T } from '../../theme.ts'
import { Heading, Keys, Mark } from '../primitives.tsx'
import { OpenItems, row, stateWords, title } from './parts.tsx'

export function DraftDetail({
  item,
  draft,
  width,
}: {
  item: Item
  draft?: Draft | undefined
  width: number
}) {
  const lines = wrapText(draft?.text ?? '', width).filter((l, i, a) => l || i < a.length - 1)
  return (
    <>
      {title(item.name)}
      <Text>
        <Mark state="draft" />
        <Text color={T.draft}> a draft, not started</Text>
        <Text color={T.dim}>{` · last edit ${ago(item.startedAt)} ago`}</Text>
      </Text>
      <Text> </Text>
      {row('project', item.key)}
      {lines.slice(1, 5).map((l, i) => (
        <Text key={i} color={T.dim} wrap="truncate-end">
          {l || ' '}
        </Text>
      ))}
      <Text> </Text>
      <Keys keys={[['⏎', 'keep writing']]} />
      <Text color={T.dim}>then esc, s starts the conversation</Text>
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
                  ['m', 'mark done'],
                  ['i', 'interrupt'],
                ]
              : [
                  ['⏎', 'open here'],
                  ['m', 'bring it back'],
                ]
          }
        />
      ) : (
        <Text color={T.dim}>An interactive terminal: switch to it directly.</Text>
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
