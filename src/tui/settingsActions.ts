import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  loadConfig,
  parsePrefixList,
  prefixesOf,
  relabel,
  setDefaultAccount,
  setPrefixes,
  type Config,
} from '../config.ts'
import { writeAtomic } from '../fsutil.ts'
import { loadProjects, parseProjects, parseSources } from '../home.ts'
import {
  addEntry,
  nextOption,
  parseProjectsDoc,
  removeEntry,
  serializeProjectsDoc,
  setField,
  type FileKey,
  type ProjectsDoc,
  type Row,
} from '../settings.ts'
import type { AppCtx } from './context.ts'
import { MOUSE_OFF, MOUSE_ON } from './mouse.ts'
import type { Form } from './state.ts'

type Commit = (edit: (c: Config) => Config, done?: string) => Promise<Config | null>
type SettingRow = Extract<Row, { kind: 'setting' }>

export const filePath = (config: Config, file: FileKey) =>
  file === 'config'
    ? config.path
    : file === 'accounts'
      ? config.accountsPath
      : join(config.home, 'projects.toml')

// What the settings screen does. Every write goes to the file it came from; projects.toml is
// checked (parsed, then loaded) before it's kept, and put back if it doesn't load.
export function makeSettingsActions(ctx: AppCtx, commit: Commit) {
  const { config, setMessage, setForm } = ctx

  const writeProjects = async (edit: (d: ProjectsDoc) => ProjectsDoc, done: string) => {
    const path = filePath(config, 'projects')
    const before = await readFile(path, 'utf8')
    try {
      const next = serializeProjectsDoc(edit(parseProjectsDoc(before)))
      parseSources(next)
      parseProjects(next, config.home)
      await writeAtomic(path, next)
      try {
        await loadProjects(config.home)
      } catch (e) {
        await writeAtomic(path, before)
        throw e
      }
      setMessage(done)
    } catch (e) {
      setMessage(`Not saved: ${(e as Error).message}`)
    }
    await ctx.reloadSettings()
    await ctx.refresh(false)
  }

  // The prefixes an account runs, other than the default's "".
  const ownPrefixes = (c: Config, name: string) =>
    prefixesOf(c, name)
      .map((p) => p.prefix)
      .filter((p) => p !== '')
  const isDefault = (c: Config, name: string) => prefixesOf(c, name).some((p) => p.prefix === '')

  // null resets it to its default.
  const apply = async (row: SettingRow, value: string | null) => {
    const t = row.target
    if (row.edit.type === 'readonly')
      return setMessage(`${row.label} is changed in the file: o opens it.`)
    if (t.file === 'accounts') {
      const name = t.account
      if (t.field === 'label')
        return void commit((c) => relabel(c, name, value ?? name), `${name} renamed`)
      if (t.field === 'prefixes') {
        return void commit((c) => {
          const wanted = value ? parsePrefixList(value).filter((p) => p !== '') : []
          return setPrefixes(c, name, isDefault(c, name) ? ['', ...wanted] : wanted)
        }, `${name} routes saved`)
      }
      return void commit(
        (c) =>
          value === 'yes' ? setDefaultAccount(c, name) : setPrefixes(c, name, ownPrefixes(c, name)),
        value === 'yes' ? `${name} is the default` : `${name} is no longer the default`,
      )
    }
    if (t.file === 'projects') {
      if (value === null && (t.field === 'key' || t.field === 'prefix' || t.field === 'repo'))
        return setMessage(`${row.label} can't be blank; d on the entry above removes it.`)
      return writeProjects(
        (d) => setField(d, t.table, t.index, t.field, value),
        value === null ? `${row.label} back to its default` : `${row.label} saved`,
      )
    }
  }

  // ⏎: a choice moves to its next option; text opens the input line.
  const edit = (row: Row) => {
    if (row.kind !== 'setting') {
      if (row.kind === 'section' && row.add) return add(row)
      return
    }
    if (row.edit.type === 'readonly') return void apply(row, null)
    if (row.edit.type === 'choice')
      return void apply(row, nextOption(row.edit.options, row.raw) || null)
    setForm({ kind: 'setting', name: row.label, value: row.raw || row.value, id: row.id })
  }

  const reset = (row: Row) => {
    if (row.kind === 'setting') {
      if (!row.isSet) return setMessage(`${row.label} is already the default.`)
      return void apply(row, null)
    }
    if (row.kind !== 'group' || !row.remove) return
    // An account already has its own yes/no.
    if (row.remove.file === 'accounts') return setForm({ kind: 'remove', name: row.remove.account })
    setForm({ kind: 'setting-remove', name: row.label, id: row.id })
  }

  const add = (section: Extract<Row, { kind: 'section' }>) => {
    if (section.id === 'accounts') return setForm({ kind: 'add-name', value: '' })
    if (section.id === 'sources') return setForm({ kind: 'setting-add-source', value: '' })
    if (section.id === 'projects') return setForm({ kind: 'setting-add-project', value: '' })
    setMessage('Nothing to add here.')
  }

  // Edits the file itself in $EDITOR, then reads everything again.
  const openFile = async (file: FileKey) => {
    const path = filePath(config, file)
    const editor = process.env['VISUAL'] || process.env['EDITOR'] || 'vi'
    await ctx.suspendTerminal(async () => {
      process.stdout.write(MOUSE_OFF)
      await new Promise<void>((resolve) => {
        const child = spawn(editor, [path], { stdio: 'inherit', shell: true })
        child.on('exit', () => resolve())
        child.on('error', () => resolve())
      })
      process.stdout.write(MOUSE_ON)
    })
    try {
      const next = await loadConfig(config.path)
      if (next) ctx.setConfig(next)
      setMessage(
        `Read ${file === 'projects' ? 'projects.toml' : file === 'accounts' ? 'accounts.toml' : 'config.toml'} again.`,
      )
    } catch (e) {
      setMessage((e as Error).message)
    }
    await ctx.reloadSettings()
    await ctx.refresh(false)
  }

  const submit = async (f: Form) => {
    setForm(null)
    const row = 'id' in f ? ctx.settingRows.find((r) => r.id === f.id) : undefined
    if (f.kind === 'setting' && row?.kind === 'setting') {
      const v = f.value.trim()
      // Submitting what was shown, for something not set, leaves it unset.
      if (!row.isSet && v === row.value) return
      return apply(row, v || null)
    }
    if (f.kind === 'setting-remove' && row?.kind === 'group' && row.remove) {
      const t = row.remove
      if (t.file === 'projects')
        return writeProjects((d) => removeEntry(d, t.table, t.index), `Removed ${row.label}.`)
    }
    if (f.kind === 'setting-add-source') {
      const [prefix, ...rest] = f.value.trim().split(/\s+/)
      const repo = rest.join(' ')
      if (!prefix || !repo)
        return setMessage('Give a prefix and the meta repo folder: kf ~/path/kf-meta')
      return writeProjects(
        (d) => addEntry(d, 'source', { prefix: prefix.replace(/\/$/, ''), repo }),
        `Added ${prefix}/.`,
      )
    }
    if (f.kind === 'setting-add-project') {
      const key = f.value.trim()
      if (!key) return
      return writeProjects((d) => addEntry(d, 'project', { key }), `Added ${key}.`)
    }
  }

  return {
    settingsEdit: edit,
    settingsReset: reset,
    settingsAdd: add,
    settingsOpenFile: openFile,
    submitSettingsForm: submit,
  }
}
