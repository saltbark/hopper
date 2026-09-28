import { Text } from 'ink'

import type { OpenItem } from '../../../items.ts'
import { tildify } from '../../../paths.ts'
import { T } from '../../theme.ts'
import { Heading, Keys } from '../primitives.tsx'
import { OpenItems, row, title } from './parts.tsx'

export type ProjectView = {
  key: string
  path?: string
  open?: number | null
  items?: OpenItem[] | null
}

export function ProjectDetail({ project, width }: { project: ProjectView; width: number }) {
  return (
    <>
      {title(project.key)}
      {project.path ? row('path', tildify(project.path)) : row('folder', 'a group of projects')}
      <Text> </Text>
      <Keys
        keys={[
          ['⏎', 'focus it'],
          ['tab', 'new conversation here'],
          ['z', 'fold'],
        ]}
      />
      <Text> </Text>
      {project.items?.length ? (
        <>
          <Heading label="open" width={width} />
          <OpenItems items={project.items} max={12} width={width} />
        </>
      ) : (
        <Text color={T.dim}>
          {project.path ? 'No open items yet. In a conversation, ask Claude to file one.' : ''}
        </Text>
      )}
    </>
  )
}
