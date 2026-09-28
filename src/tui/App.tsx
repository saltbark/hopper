import { Box, useApp, useInput, useWindowSize } from 'ink'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { prefixesOf, saveAccounts, type Config } from '../config.ts'
import { draftSessionId, gather, inScope, OTHER, routineSessionId, type Item } from '../model.ts'
import type { Routine } from '../routines/index.ts'
import { buildRows } from '../settings.ts'
import { buildTree, type TreeRow } from '../tree.ts'
import { defaultSync, makeActions } from './actions.ts'
import type { AppCtx } from './context.ts'
import type { EmbeddedSession } from './embed.ts'
import { rank, withFolders } from './fuzzy.ts'
import {
  useDraftAutosave,
  useFoldImported,
  useSettingsDoc,
  useProjectItems,
  useSnapshot,
  useUsage,
  type Loader,
} from './hooks.ts'
import type { Here } from './keymap.ts'
import { makeInput } from './keys.ts'
import { Detail, detailTitle } from './panels/detail/index.tsx'
import { accountColor, Frame } from './panels/primitives.tsx'
import { LeftColumn, MiddleColumn } from './panes/Columns.tsx'
import { DraftPane } from './panes/DraftPane.tsx'
import { HelpPane } from './panes/HelpPane.tsx'
import { KeyBar } from './panes/KeyBar.tsx'
import { PickPane } from './panes/PickPane.tsx'
import { SessionPane } from './panes/SessionPane.tsx'
import { SettingsPane } from './panes/SettingsPane.tsx'
import {
  blankState,
  groupOf,
  groupRank,
  type Editing,
  type Find,
  type Focus,
  type Form,
  type Panel,
  type Sel,
} from './state.ts'

export type { Loader }
export type Saver = typeof saveAccounts

const LISTED = new Set<Item['where']>(['queue', 'needs', 'routine'])
const byGroup = (a: Item, b: Item) =>
  groupRank(groupOf(a)) - groupRank(groupOf(b)) || b.startedAt - a.startedAt

export function App({
  config: initialConfig,
  load = gather,
  save = saveAccounts,
  syncSchedule = defaultSync,
}: {
  config: Config
  load?: Loader
  save?: Saver
  syncSchedule?: (config: Config, routines: Routine[]) => Promise<unknown>
}) {
  const { exit, suspendTerminal } = useApp()
  const { columns, rows } = useWindowSize()

  const [config, setConfig] = useState(initialConfig)
  const [focus, setFocus] = useState<Focus>('projects')
  // The conversation open in the right panel, if any; it keeps running while you're elsewhere.
  const [embed, setEmbed] = useState<EmbeddedSession | null>(null)
  const [returnTo, setReturnTo] = useState<Panel>('work')
  const [embedShown, setEmbedShown] = useState(false)
  const [pick, setPick] = useState<(Sel & { active: boolean }) | null>(null)
  const [sel, setSel] = useState<Record<Panel, number>>({
    projects: 0,
    work: 0,
    done: 0,
    accounts: 0,
  })
  const [scope, setScope] = useState<string | null>(null)
  const [folded, setFolded] = useState<Set<string>>(() => new Set())
  const [help, setHelp] = useState(false)
  const [settings, setSettings] = useState<{ sel: number } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [find, setFind] = useState<Find | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  // A draft Claude refused to start because its folder isn't trusted yet; T trusts and starts it.
  const [untrusted, setUntrusted] = useState<{ dir: string; draft: Editing } | null>(null)

  const { snap, snapRef, error, refresh } = useSnapshot(config, load)
  const { usageText, askUsage } = useUsage(config.home, snapRef, refresh)
  useDraftAutosave(editing, config.home)
  useFoldImported(snap, setFolded)
  const settingsDoc = useSettingsDoc(!!settings, config.home)
  const settingRows = useMemo(
    () => buildRows(config, settingsDoc.doc, snap?.projects ?? [], settingsDoc.missing),
    [config, settingsDoc.doc, settingsDoc.missing, snap],
  )
  useEffect(() => () => embed?.close(), [embed])

  // ---- derived ----
  const color = useCallback((name: string) => accountColor(config, name), [config])
  const { work, done } = useMemo(() => {
    const scoped = (snap?.items ?? []).filter((i) => inScope(i.key, scope))
    return {
      work: scoped.filter((i) => LISTED.has(i.where)).sort(byGroup),
      done: scoped.filter((i) => i.where === 'done'),
    }
  }, [snap, scope])
  const projectKeys = useMemo(() => (snap?.projects ?? []).map((p) => p.key), [snap])

  const treeRows = useMemo(() => {
    if (!snap) return []
    const count = (key: string, w: Item['where']) =>
      snap.items.filter((i) => i.key === key && i.where === w).length
    const counts = (key: string, open: number) => ({
      open,
      run: count(key, 'queue'),
      you: count(key, 'needs'),
    })
    const entries = snap.projects.map((p) => ({
      key: p.key,
      isProject: true,
      counts: counts(p.key, snap.openCounts.get(p.key) ?? 0),
    }))
    if (snap.items.some((i) => i.key === OTHER))
      entries.push({ key: OTHER, isProject: false, counts: counts(OTHER, 0) })
    return buildTree(entries, folded)
  }, [snap, folded])

  // Every project and every folder above one, for finding.
  const allKeys = useMemo(() => withFolders(projectKeys), [projectKeys])
  const findRows = useMemo<TreeRow[]>(() => {
    if (!find) return []
    return rank(find.query, allKeys).map((key) => ({
      key,
      name: key,
      depth: 0,
      isProject: projectKeys.includes(key),
      hasChildren: false,
      folded: false,
      counts: treeRows.find((r) => r.key === key)?.counts ?? { open: 0, run: 0, you: 0 },
    }))
  }, [find, allKeys, projectKeys, treeRows])

  const accountStates = useMemo(
    () =>
      config.accounts.map(
        (a) => snap?.accounts.find((s) => s.account.name === a.name) ?? blankState(a),
      ),
    [config, snap],
  )
  const lists: Record<Panel, number> = {
    projects: treeRows.length,
    work: work.length,
    done: done.length,
    accounts: accountStates.length,
  }
  const at = (p: Panel) => Math.max(0, Math.min(sel[p], lists[p] - 1))
  const selectedRow = treeRows[at('projects')]
  const listFocus: Panel = focus === 'session' ? returnTo : focus
  const selectedItem =
    listFocus === 'work' ? work[at('work')] : listFocus === 'done' ? done[at('done')] : undefined
  const scopeProject = scope && projectKeys.includes(scope) ? scope : null
  const showingEmbed =
    !!embed && (focus === 'session' || embedShown || selectedItem?.id === embed.id)
  // What the key bar and the help screen describe.
  const here: Here = {
    focus,
    row: selectedRow,
    item: selectedItem,
    scope,
    embedOpen: !!embed && !!selectedItem?.id && selectedItem.id === embed.id,
    summaryShown: !showingEmbed,
    untrusted: !!untrusted,
    editing,
    setting: settings ? (settingRows[settings.sel] ?? null) : undefined,
  }

  // The project whose open items show on the right: the highlighted one, else the selected
  // conversation's, else the scope.
  const itemsKey =
    focus === 'projects' && selectedRow && projectKeys.includes(selectedRow.key)
      ? selectedRow.key
      : selectedItem
        ? projectKeys.includes(selectedItem.key)
          ? selectedItem.key
          : null
        : scopeProject
  const openItems = useProjectItems(snap, itemsKey)

  // ---- layout ----
  // Left: accounts over projects. Middle: the list over done. Right: whatever is focused. No
  // status line on top: every panel says its own state, so the body runs down to the key bar.
  const W = columns
  // Every row: Ink 7 writes a frame exactly the terminal's height without a trailing newline, so
  // it neither scrolls nor repaints. Only a taller frame makes it clear the screen.
  const H = Math.max(12, rows)
  const bodyH = H - 1
  const leftW = Math.max(32, Math.min(46, Math.round(W * 0.24)))
  const midW = Math.max(36, Math.min(64, Math.round(W * 0.3)))
  // Exactly what is left: panels draw their own top edges to their width, so the columns must
  // add up to the terminal rather than be squeezed by flexbox.
  const rightW = Math.max(20, W - leftW - midW)
  // Accounts: the top edge, a column header, one line each, the bottom edge.
  const accountsH = Math.min(Math.round(bodyH * 0.45), 3 + Math.max(1, accountStates.length))
  const doneH = Math.max(6, Math.min(14, Math.round(bodyH * 0.28)))
  const workH = bodyH - doneH
  // The conversation fills the right panel inside its border; the title is in the top edge.
  const sessionCols = rightW - 2
  const sessionRows = bodyH - 2
  useEffect(() => embed?.resize(sessionCols, sessionRows), [embed, sessionCols, sessionRows])

  const ctx: AppCtx = {
    config,
    setConfig,
    save,
    syncSchedule,
    snap,
    snapRef,
    refresh,
    askUsage,
    suspendTerminal,
    exit,
    focus,
    setFocus,
    returnTo,
    setReturnTo,
    listFocus,
    embed,
    setEmbed,
    embedShown,
    setEmbedShown,
    pick,
    setPick,
    sel,
    setSel,
    scope,
    setScope,
    setFolded,
    help,
    setHelp,
    settings,
    setSettings,
    settingRows,
    reloadSettings: settingsDoc.reload,
    message,
    setMessage,
    form,
    setForm,
    find,
    setFind,
    editing,
    setEditing,
    untrusted,
    setUntrusted,
    work,
    done,
    projectKeys,
    treeRows,
    findRows,
    accountStates,
    lists,
    at,
    selectedRow,
    selectedItem,
    scopeProject,
    showingEmbed,
    layout: { leftW, midW, rightW, accountsH, workH, sessionCols, sessionRows },
  }
  const actions = makeActions(ctx)
  useInput(makeInput(ctx, actions))

  // ---- the right panel ----
  const right = (() => {
    if (editing) {
      return editing.stage === 'pick' ? (
        <PickPane
          query={editing.query}
          sel={editing.pickSel}
          candidates={rank(editing.query, projectKeys)}
          width={rightW}
          height={bodyH}
        />
      ) : (
        <DraftPane editing={editing} width={rightW} height={bodyH} />
      )
    }
    if (embed && showingEmbed) {
      return (
        <SessionPane
          session={embed}
          focused={focus === 'session'}
          width={rightW}
          height={bodyH}
          selection={pick}
        />
      )
    }
    const accountState = listFocus === 'accounts' ? accountStates[at('accounts')] : undefined
    const account = accountState && {
      state: accountState,
      routes: prefixesOf(config, accountState.account.name),
      usageLines: usageText[accountState.account.name],
      now: snap?.at ?? 0,
    }
    const projectKey = focus === 'projects' ? selectedRow?.key : !selectedItem ? scopeProject : null
    const found = snap?.projects.find((x) => x.key === projectKey)
    const project =
      !selectedItem && projectKey && projectKey !== OTHER
        ? {
            key: projectKey,
            ...(found ? { path: found.path, open: snap?.openCounts.get(projectKey) ?? null } : {}),
            items: openItems,
          }
        : undefined
    const draft =
      selectedItem?.kind === 'draft'
        ? snap?.drafts.find((d) => draftSessionId(d.id) === selectedItem.sessionId)
        : undefined
    const r =
      selectedItem?.kind === 'routine'
        ? snap?.routines.find((x) => routineSessionId(x.name) === selectedItem.sessionId)
        : undefined
    const routine =
      r && snap
        ? {
            routine: r,
            runs: snap.runs.filter((x) => x.routine === r.name),
            results: snap.results,
            account: selectedItem?.account,
            now: snap.at,
          }
        : undefined
    return (
      <Frame title={detailTitle(selectedItem, project, account)} width={rightW} height={bodyH}>
        <Detail
          item={selectedItem}
          draft={draft}
          project={project}
          account={account}
          openItems={selectedItem ? openItems : undefined}
          routine={routine}
          width={rightW}
        />
      </Frame>
    )
  })()

  return (
    <Box flexDirection="column" width={W} height={H}>
      {help ? (
        <HelpPane config={config} here={here} width={W} height={bodyH} />
      ) : settings ? (
        <SettingsPane
          config={config}
          rows={settingRows}
          sel={Math.min(settings.sel, Math.max(0, settingRows.length - 1))}
          error={settingsDoc.error}
          width={W}
          height={bodyH}
        />
      ) : (
        <Box flexDirection="row" height={bodyH}>
          <LeftColumn
            snap={snap}
            accountStates={accountStates}
            accountSel={at('accounts')}
            treeRows={treeRows}
            findRows={findRows}
            projectSel={at('projects')}
            find={find}
            scope={scope}
            focus={focus}
            color={color}
            width={leftW}
            accountsH={accountsH}
            projectsH={bodyH - accountsH}
          />
          <MiddleColumn
            loaded={!!snap}
            work={work}
            done={done}
            workSel={at('work')}
            doneSel={at('done')}
            scope={scope}
            focus={focus}
            color={color}
            width={midW}
            workH={workH}
            doneH={doneH}
          />
          {right}
        </Box>
      )}
      <KeyBar
        form={form}
        editing={editing}
        find={find}
        here={here}
        message={message}
        error={error}
      />
    </Box>
  )
}
