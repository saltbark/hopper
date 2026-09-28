import { Text } from 'ink'

import { layout, locate, selection, type VisualLine } from '../editor.ts'
import { Frame } from '../panels/primitives.tsx'
import { modelLabel, type Editing } from '../state.ts'

// The text box for a draft or a routine's prompt, with its cursor and selection.
export function DraftPane({
  editing,
  width,
  height,
}: {
  editing: Editing
  width: number
  height: number
}) {
  const w = width - 4
  const writing = editing.stage === 'write'
  const lines = layout(editing.text, w)
  const cursorLine = locate(lines, editing.cursor).line
  const sel = selection(editing)
  const room = Math.max(1, height - 4)
  // Keep the cursor in view: follow it once it passes the bottom.
  const start = Math.max(0, Math.min(cursorLine - room + 1, lines.length - room))
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
          ? `${editing.project} · ${r.schedule || 'run-now only'}${r.enabled ? '' : ' · paused'} · ${modelLabel(editing.model, editing.effort)}`
          : `${editing.project} · ${modelLabel(editing.model, editing.effort)} · a draft until you start it`
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
