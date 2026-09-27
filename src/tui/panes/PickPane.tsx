import { Text } from 'ink'

import { cell } from '../../format.ts'
import { Frame, windowed } from '../panels/primitives.tsx'

// Choosing another project for a draft or routine: type to filter, ↑↓ to choose.
export function PickPane(props: {
  query: string
  sel: number
  candidates: string[]
  width: number
  height: number
}) {
  const { query, sel, candidates, width, height } = props
  const w = width - 4
  const { start, slice } = windowed(candidates, sel, height - 6)
  return (
    <Frame title="MOVE TO PROJECT" meta="type to filter" width={width} height={height} focused>
      <Text>
        <Text dimColor>project </Text>
        {query}
        <Text inverse> </Text>
      </Text>
      <Text> </Text>
      {slice.length ? (
        slice.map((k, i) => (
          <Text key={k} wrap="truncate-end" inverse={start + i === sel}>
            {cell(k, w)}
          </Text>
        ))
      ) : (
        <Text dimColor>No project matches.</Text>
      )}
    </Frame>
  )
}
