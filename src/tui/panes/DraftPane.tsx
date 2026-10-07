import { Text } from 'ink'

import type { Choice } from '../../config.ts'
import { locate, selection, textWidth, view, type VisualLine } from '../editor.ts'
import { Frame } from '../panels/primitives.tsx'
import { modelLabel, type Editing } from '../state.ts'

// How many lines of text the box shows, in a pane this tall.
export const draftRoom = (height: number) => Math.max(1, height - 4)

// The text box for a draft or a routine's prompt, with its cursor and selection.
export function DraftPane({
  editing,
  defaults,
  width,
  height,
}: {
  editing: Editing
  // What it runs with where it picks no model or effort.
  defaults: Choice
  width: number
  height: number
}) {
  const writing = editing.stage === 'write'
  const room = draftRoom(height)
  const { lines, start } = view(editing, textWidth(width), room)
  const cursorLine = locate(lines, editing.cursor).line
  const sel = selection(editing)
  const shown = lines.slice(start, start + room)

  const row = (l: VisualLine, i: number) => {
    const segs: { text: string; inverse: boolean }[] = []
    const push = (ch: string, inverse: boolean) => {
      const last = segs.at(-1)
      if (last && last.inverse === inverse) last.text += ch
      else segs.push({ text: ch, inverse })
    }
    for (let x = l.start; x < l.end; x++) {
      const selected = !!sel && x >= sel[0] && x < sel[1]
      push(editing.text[x] ?? ' ', selected || (writing && x === editing.cursor))
    }
    // The cursor sits after the last character of its line.
    if (writing && cursorLine === start + i && editing.cursor === l.end) push(' ', true)
    return (
      <Text key={i}>
        {segs.length
          ? segs.map((sg, k) => (
              <Text key={k} inverse={sg.inverse}>
                {sg.text}
              </Text>
            ))
          : ' '}
      </Text>
    )
  }

  const r = editing.routine
  return (
    <Frame
      title={r ? `ROUTINE ${r.name}` : 'NEW CONVERSATION'}
      meta={
        r
          ? `${editing.project} · ${r.schedule || 'run-now only'}${r.enabled ? '' : ' · paused'} · ${modelLabel(editing.model, editing.effort, defaults)}`
          : `${editing.project} · ${modelLabel(editing.model, editing.effort, defaults)} · a draft until you start it`
      }
      width={width}
      height={height}
      focused
    >
      {editing.text ? null : (
        <Text dimColor wrap="truncate-end">
          ⏎ new line · esc saves it to the list
        </Text>
      )}
      {shown.map(row)}
    </Frame>
  )
}
