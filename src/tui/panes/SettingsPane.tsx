import { Box, Text } from 'ink'

import type { Config } from '../../config.ts'
import { tildify } from '../../paths.ts'
import type { Edit, Row } from '../../settings.ts'
import { Frame, windowed } from '../panels/primitives.tsx'
import { filePath } from '../settingsActions.ts'
import { T } from '../theme.ts'

const LABEL_W = 14

function ListRow({ row, selected, width }: { row: Row; selected: boolean; width: number }) {
  const mark = <Text color={T.focus}>{selected ? '▌' : ' '}</Text>
  if (row.kind === 'section') {
    return (
      <Text wrap="truncate-end">
        {mark}
        <Text color={T.hi} bold>
          {row.label.toUpperCase()}
        </Text>
        <Text color={T.faint}>{'  ' + fileName(row.file)}</Text>
      </Text>
    )
  }
  if (row.kind === 'group') {
    return (
      <Text wrap="truncate-end" backgroundColor={selected ? T.sel : undefined}>
        {mark}
        <Text color={row.label.startsWith('!') ? T.blocked : T.text} bold>
          {'  ' + row.label}
        </Text>
      </Text>
    )
  }
  const label = row.label.padEnd(LABEL_W).slice(0, LABEL_W)
  return (
    <Box width={width}>
      <Text wrap="truncate-end" backgroundColor={selected ? T.sel : undefined}>
        {mark}
        <Text color={T.dim}>{'    ' + label}</Text>
        <Text color={row.isSet ? T.text : T.faint}>{row.value || '—'}</Text>
        {row.isSet ? null : <Text color={T.faint}>{'  default'}</Text>}
        {row.warn ? <Text color={T.blocked}>{'  ' + row.warn}</Text> : null}
      </Text>
    </Box>
  )
}

// How a choice's "not set" reads: the default it falls back to, named where it has a name.
const choiceName = (edit: Edit) =>
  'fallback' in edit && edit.fallback ? `${edit.fallback} (default)` : 'default'

const fileName = (file: Row['file']) =>
  file === 'config' ? 'config.toml' : file === 'accounts' ? 'accounts.toml' : 'projects.toml'

function About({ row, config }: { row: Row | undefined; config: Config }) {
  if (!row) return <Text color={T.dim}>Nothing here.</Text>
  const how =
    row.kind === 'section'
      ? row.add
        ? 'a adds one.'
        : ''
      : row.kind === 'group'
        ? row.remove
          ? 'd removes it.'
          : ''
        : row.edit.type === 'readonly'
          ? 'Set in the file: o opens it.'
          : row.edit.type === 'choice'
            ? `⏎ cycles: ${row.edit.options.map((o) => o || choiceName(row.edit)).join(', ')}.${row.isSet ? ' d goes back to the default.' : ''}`
            : `⏎ edits it.${row.isSet ? ' d goes back to the default.' : ''}`
  return (
    <>
      <Text color={T.hi} bold>
        {row.label}
      </Text>
      {row.kind === 'setting' ? (
        <Text>
          <Text color={row.isSet ? T.text : T.faint}>{row.value || '—'}</Text>
          <Text color={T.dim}>{row.isSet ? '  set' : '  default'}</Text>
        </Text>
      ) : null}
      <Text> </Text>
      <Text color={T.text}>{row.help}</Text>
      <Text> </Text>
      {how ? <Text color={T.dim}>{how}</Text> : null}
      <Text color={T.faint}>{tildify(filePath(config, row.file))}</Text>
    </>
  )
}

// Every setting, grouped by the file it lives in. Like a settings UI over a JSON file: the
// files stay the truth and can be edited by hand (o).
export function SettingsPane(props: {
  config: Config
  rows: Row[]
  sel: number
  error: string | null
  width: number
  height: number
}) {
  const { config, rows, sel, error, width, height } = props
  const listW = Math.max(40, Math.round(width * 0.58))
  const aboutW = width - listW
  const { slice, start } = windowed(rows, sel, height - 2)
  return (
    <Box flexDirection="row" height={height}>
      <Frame
        title="SETTINGS"
        meta={error ?? 'esc closes'}
        width={listW}
        height={height}
        focused
        inset="rail"
      >
        {slice.map((r, i) => (
          <ListRow key={r.id} row={r} selected={start + i === sel} width={listW - 4} />
        ))}
      </Frame>
      <Frame title="ABOUT" width={aboutW} height={height}>
        <About row={rows[sel]} config={config} />
      </Frame>
    </Box>
  )
}
