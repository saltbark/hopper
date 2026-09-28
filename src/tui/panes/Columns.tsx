import { Box, Text } from 'ink'

import { ago } from '../../format.ts'
import type { AccountState, Item, Snapshot } from '../../model.ts'
import type { TreeRow } from '../../tree.ts'
import { AccountRow, AccountsHeader } from '../panels/Accounts.tsx'
import { ItemRows } from '../panels/ItemRows.tsx'
import { Frame, windowed } from '../panels/primitives.tsx'
import { ProjectRows } from '../panels/ProjectRows.tsx'
import type { Find, Focus } from '../state.ts'
import { T } from '../theme.ts'
import { WorkRows } from './WorkRows.tsx'

// Left: accounts over projects.
export function LeftColumn(props: {
  snap: Snapshot | null
  accountStates: AccountState[]
  accountSel: number
  treeRows: TreeRow[]
  findRows: TreeRow[]
  projectSel: number
  find: Find | null
  scope: string | null
  focus: Focus
  color: (account: string) => string
  width: number
  accountsH: number
  projectsH: number
}) {
  const { snap, accountStates, accountSel, find, focus, color, width, accountsH, projectsH } = props
  // The name column fits the longest account name.
  const nameW = Math.max(4, ...accountStates.map((a) => a.account.name.length + 2))
  // How old the usage numbers are, always shown: the oldest of them.
  const read = accountStates.map((a) => a.usage?.fetchedAt ?? 0).filter(Boolean)
  const usageAge = read.length ? `read ${ago(Math.min(...read), snap?.at ?? 0)} ago` : undefined
  const finding = !!find
  const rows = find ? props.findRows : props.treeRows
  return (
    <Box flexDirection="column" width={width}>
      <Frame
        title="ACCOUNTS"
        keyHint="a"
        {...(usageAge ? { meta: usageAge } : {})}
        width={width}
        height={accountsH}
        focused={focus === 'accounts'}
        inset="rail"
      >
        {accountStates.length ? (
          <>
            <AccountsHeader width={width} nameW={nameW} />
            {windowed(accountStates, accountSel, Math.max(1, accountsH - 3)).slice.map((a) => (
              <AccountRow
                key={a.account.name}
                a={a}
                width={width}
                nameW={nameW}
                color={color(a.account.name)}
                selected={accountStates.indexOf(a) === accountSel}
                focused={focus === 'accounts'}
                now={snap?.at ?? 0}
              />
            ))}
          </>
        ) : (
          <Text color={T.dim}> No Claude accounts yet. c, then a, adds one.</Text>
        )}
      </Frame>
      <Frame
        title="PROJECTS"
        keyHint="p"
        meta={
          find
            ? `${rows.length} found`
            : (snap?.projectsError ?? String(snap?.projects.length ?? '…'))
        }
        width={width}
        height={projectsH}
        focused={focus === 'projects' || finding}
        inset="rail"
      >
        <ProjectRows
          rows={rows}
          sel={find ? Math.min(find.sel, Math.max(0, rows.length - 1)) : props.projectSel}
          focused={focus === 'projects' || finding}
          scope={find ? null : props.scope}
          width={width}
          height={projectsH}
        />
      </Frame>
    </Box>
  )
}

// Middle: every conversation, grouped, over the ones marked done.
export function MiddleColumn(props: {
  loaded: boolean
  work: Item[]
  done: Item[]
  workSel: number
  doneSel: number
  scope: string | null
  focus: Focus
  color: (account: string) => string
  width: number
  workH: number
  doneH: number
}) {
  const { work, done, focus, color, width, workH, doneH } = props
  return (
    <Box flexDirection="column" width={width}>
      <Frame
        title="CONVERSATIONS"
        keyHint="c"
        // The counts are on the group headings; the edge says what the list is narrowed to.
        meta={props.scope ?? 'all projects'}
        width={width}
        height={workH}
        focused={focus === 'work'}
        inset="rail"
      >
        {work.length ? (
          <WorkRows
            items={work}
            sel={props.workSel}
            focused={focus === 'work'}
            width={width}
            height={workH}
            color={color}
          />
        ) : (
          <Text color={T.dim}>
            {props.loaded ? ' Nothing going on. t starts a conversation.' : ' Loading…'}
          </Text>
        )}
      </Frame>
      <Frame
        title="DONE"
        keyHint="v"
        meta={String(done.length)}
        width={width}
        height={doneH}
        focused={focus === 'done'}
        inset="rail"
      >
        <ItemRows
          items={done}
          sel={props.doneSel}
          focused={focus === 'done'}
          width={width}
          height={doneH}
          empty="Nothing marked done yet."
          color={color}
          done
        />
      </Frame>
    </Box>
  )
}
