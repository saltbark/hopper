import { Text } from 'ink'

import type { Draft } from '../../../drafts.ts'
import type { OpenItem } from '../../../items.ts'
import type { Item } from '../../../model.ts'
import { T } from '../../theme.ts'
import { AccountDetail, type AccountView } from './AccountDetail.tsx'
import { ConversationDetail, DraftDetail } from './ItemDetail.tsx'
import { ProjectDetail, type ProjectView } from './ProjectDetail.tsx'
import { RoutineDetail, type RoutineView } from './RoutineDetail.tsx'

export { detailTitle } from './parts.tsx'
export type { AccountView, ProjectView, RoutineView }

// The right panel when no conversation or draft is open in it: whatever is selected.
export function Detail(props: {
  item: Item | undefined
  draft?: Draft | undefined
  project: ProjectView | undefined
  account: AccountView | undefined
  // The open items of the selected conversation's project.
  openItems?: OpenItem[] | null | undefined
  routine?: RoutineView | undefined
  // The selected report, while a routine's reports have the keyboard.
  reportSel?: number | undefined
  width: number
  height: number
}) {
  const { item, draft, project, account, openItems, routine } = props
  const w = props.width - 4
  if (account) return <AccountDetail account={account} width={w} />
  if (project) return <ProjectDetail project={project} width={w} />
  if (!item) return <Text color={T.dim}>Nothing selected.</Text>
  if (item.kind === 'routine' && routine)
    return (
      <RoutineDetail view={routine} width={w} height={props.height - 2} sel={props.reportSel} />
    )
  if (item.kind === 'draft') return <DraftDetail item={item} draft={draft} width={w} />
  return <ConversationDetail item={item} openItems={openItems} width={w} />
}
