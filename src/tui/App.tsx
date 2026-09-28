import { Box, useApp, useInput, useWindowSize } from 'ink'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { playChime, type Chime } from '../chime.ts'
import { prefixesOf, saveAccounts, type Config } from '../config.ts'
import { draftSessionId, gather, inScope, OTHER, routineSessionId, type Item } from '../model.ts'
import type { Routine } from '../routines/index.ts'
import { buildRows } from '../settings.ts'
import { activeRows, buildTree, type TreeRow } from '../tree.ts'
import { defaultSync, makeActions } from './actions.ts'
import type { AppCtx } from './context.ts'
import { rank, withFolders } from './fuzzy.ts'
import {
  useChime,
  useDraftAutosave,
  useFoldImported,
  useOpenConversations,
  useSettingsDoc,
  useProjectItems,
  useSnapshot,
  useTabTitle,
  useUsage,
  type Loader,
} from './hooks.ts'
import type { Here } from './keymap.ts'
import { makeInput } from './keys.ts'
import { Detail, detailTitle } from './panels/detail/index.tsx'
import { accountColor, Frame } from './panels/primitives.tsx'
import { Band, ListColumn } from './panes/Columns.tsx'
import { DraftPane } from './panes/DraftPane.tsx'
import { HelpPane, helpMaxScroll } from './panes/HelpPane.tsx'
import { KeyBar } from './panes/KeyBar.tsx'
import { PickPane } from './panes/PickPane.tsx'
import { ReportPane } from './panes/ReportPane.tsx'
import { SessionPane } from './panes/SessionPane.tsx'
import { SettingsPane } from './panes/SettingsPane.tsx'
import {
  blankState,
  groupOf,
  groupRank,
  type Editing,
  type Find,
  type Focus,
  type Hover,
  type Form,
  type Panel,
  type Reports,
  type Sel,
} from './state.ts'

export type { Loader }
export type Saver = typeof saveAccounts

const noTitle = () => {}

const LISTED = new Set<Item['where']>(['queue', 'needs', 'routine'])
const byGroup = (a: Item, b: Item) =>
  groupRank(groupOf(a)) - groupRank(groupOf(b)) || b.startedAt - a.startedAt

export function App({
  config: initialConfig,
  load = gather,
  save = saveAccounts,
  syncSchedule = defaultSync,
  chime = playChime,
  setTitle = noTitle,
}: {
  config: Config
  load?: Loader
  save?: Saver
  syncSchedule?: (config: Config, routines: Routine[]) => Promise<unknown>
  chime?: Chime
  // Writes the terminal tab's title; tests leave it out.
  setTitle?: (text: string) => void
}) {
  const { exit, suspendTerminal: suspendInk } = useApp()
  const { columns, rows } = useWindowSize()

  const [config, setConfig] = useState(initialConfig)
  const [focus, setFocus] = useState<Focus>('projects')
  // The conversations open, the one last gone into first. Each keeps running while you're
  // elsewhere, and shows in the right panel whenever its row is selected.
  const { embeds, setEmbeds, embedsRef } = useOpenConversations()
  const [returnTo, setReturnTo] = useState<Panel>('work')
  const [embedShown, setEmbedShown] = useState(false)
  const [pick, setPick] = useState<(Sel & { active: boolean }) | null>(null)
  const [sel, setSel] = useState<Record<Panel, number>>({
    projects: 0,
    work: 0,
    done: 0,
    accounts: 0,
  })
  const [hover, setHover] = useState<Hover>(null)
  const [scope, setScope] = useState<string | null>(null)
  const [folded, setFolded] = useState<Set<string>>(() => new Set())
  const [help, setHelp] = useState<{ scroll: number } | null>(null)
  const [settings, setSettings] = useState<{ sel: number } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [find, setFind] = useState<Find | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  // A draft Claude refused to start because its folder isn't trusted yet; T trusts and starts it.
  const [untrusted, setUntrusted] = useState<{ dir: string; draft: Editing } | null>(null)
  const [follow, setFollow] = useState<string | null>(null)
  const [reportsFocus, setReportsFocus] = useState<Reports | null>(null)

  const { snap, snapRef, error, refresh } = useSnapshot(config, load)
  const { usageText, askUsage } = useUsage(config.home, snapRef, refresh)
  useDraftAutosave(editing, config.home)
  useFoldImported(snap, setFolded)
  const suspendTerminal = useTabTitle(snap, setTitle, suspendInk)
  const settingsDoc = useSettingsDoc(!!settings, config.home)
  const settingRows = useMemo(
    () => buildRows(config, settingsDoc.doc, snap?.projects ?? [], settingsDoc.missing),
    [config, settingsDoc.doc, settingsDoc.missing, snap],
  )

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
  // Select a row that was just saved, once the list has it (state adjusted while rendering, as
  // React allows for a component's own state).
  const followAt = follow ? work.findIndex((w) => w.sessionId === follow) : -1
  if (followAt >= 0) {
    setSel((s) => ({ ...s, work: followAt }))
    setFollow(null)
  }

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
    const tree = buildTree(entries, folded)
    // Above the tree, the projects with something going on, by full key.
    const last = new Map<string, number>()
    for (const i of snap.items) last.set(i.key, Math.max(last.get(i.key) ?? 0, i.startedAt))
    const active = activeRows(
      entries
        .filter((e) => e.isProject)
        .map((e) => ({ key: e.key, counts: e.counts, last: last.get(e.key) ?? 0 })),
      scope,
      snap.at,
    )
    return [...active, ...tree]
  }, [snap, folded, scope])

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
  const selectedRoutine =
    selectedItem?.kind === 'routine'
      ? snap?.routines.find((x) => routineSessionId(x.name) === selectedItem.sessionId)
      : undefined
  const routineReports = useMemo(
    () => (selectedRoutine && snap?.reports[selectedRoutine.name]) || [],
    [selectedRoutine, snap],
  )
  // The reports have the keyboard only while their routine is the one selected.
  const reports =
    reportsFocus && reportsFocus.routine === selectedRoutine?.name && routineReports.length
      ? { ...reportsFocus, sel: Math.min(reportsFocus.sel, routineReports.length - 1) }
      : null
  const selectedReport = reports ? routineReports[reports.sel] : undefined
  // While you're in a conversation, or just stepped back from one, the panel shows the one you
  // went into; otherwise whichever open one the selected row is.
  const embed =
    focus === 'session' || embedShown
      ? (embeds[0] ?? null)
      : (embeds.find((e) => !!selectedItem?.id && e.id === selectedItem.id) ?? null)
  const showingEmbed = !!embed
  // The blue edge is where the keys go: nowhere on the left while the editor has them.
  const keysAt = editing || reports ? null : focus
  // The list whose selected row the right panel is showing, which keeps its highlight while the
  // keys are over there.
  const editingId =
    editing &&
    (editing.routine ? routineSessionId(editing.routine.name) : draftSessionId(editing.id))
  const held: Panel | null =
    focus === 'session'
      ? returnTo
      : reports || (editingId && selectedItem?.sessionId === editingId)
        ? listFocus
        : null
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
    reports: reports
      ? {
          reading: !!reports.open,
          conversation:
            !!selectedReport?.id && !!snap?.items.some((i) => i.id === selectedReport.id),
        }
      : undefined,
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
  // A band on top of the left two columns: accounts beside projects, as tall as they need up to
  // a cap. Under it the list, then done, as wide as both. Right: whatever is focused. No status
  // line on top: every panel says its own state, so the body runs down to the key bar.
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
  const listW = leftW + midW
  // Each panel in the band: the top edge, a column header, one line a row, the bottom edge, and
  // for projects the rule between the active ones and the tree. Past the cap, projects scroll.
  const hasActive = treeRows.some((r) => r.active)
  const bandNeeds = Math.max(
    3 + Math.max(1, accountStates.length),
    3 + treeRows.length + (hasActive ? 1 : 0),
  )
  const bandH = Math.min(bandNeeds, Math.max(8, Math.min(16, Math.round(bodyH * 0.3))))
  const doneH = Math.max(5, Math.min(10, Math.round(bodyH * 0.2)))
  const workH = bodyH - bandH - doneH
  // The conversation fills the right panel inside its border; the title is in the top edge.
  const sessionCols = rightW - 2
  const sessionRows = bodyH - 2
  useEffect(
    () => embeds.forEach((e) => e.resize(sessionCols, sessionRows)),
    [embeds, sessionCols, sessionRows],
  )
  // The conversation in the right panel, which doesn't need a sound to say it's waiting.
  const onScreen =
    embed && showingEmbed ? (snap?.items.find((i) => i.id === embed.id)?.sessionId ?? null) : null
  useChime(snap, config.sound, onScreen, chime)

  const ctx: AppCtx = {
    config,
    setConfig,
    save,
    syncSchedule,
    chime,
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
    embeds,
    setEmbeds,
    embedsRef,
    embed,
    embedShown,
    setEmbedShown,
    pick,
    setPick,
    sel,
    setSel,
    hover,
    setHover,
    scope,
    setScope,
    setFolded,
    help,
    setHelp,
    helpMax: helpMaxScroll(W, bodyH),
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
    setFollow,
    reports,
    setReports: setReportsFocus,
    routineReports,
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
    layout: { leftW, midW, rightW, bodyH, bandH, workH, doneH, sessionCols, sessionRows },
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
    const r = selectedRoutine
    if (r && reports?.open && selectedReport) {
      return (
        <ReportPane
          routine={r.name}
          report={selectedReport}
          text={reports.open.text}
          scroll={reports.open.scroll}
          index={reports.sel}
          count={routineReports.length}
          width={rightW}
          height={bodyH}
        />
      )
    }
    const routine =
      r && snap
        ? { routine: r, reports: routineReports, account: selectedItem?.account, now: snap.at }
        : undefined
    return (
      <Frame
        title={detailTitle(selectedItem, project, account)}
        width={rightW}
        height={bodyH}
        focused={!!reports}
      >
        <Detail
          item={selectedItem}
          draft={draft}
          project={project}
          account={account}
          openItems={selectedItem ? openItems : undefined}
          routine={routine}
          reportSel={reports?.sel}
          width={rightW}
          height={bodyH}
        />
      </Frame>
    )
  })()

  return (
    <Box flexDirection="column" width={W} height={H}>
      {help ? (
        <HelpPane config={config} here={here} scroll={help.scroll} width={W} height={bodyH} />
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
          <Box flexDirection="column" width={listW}>
            <Band
              snap={snap}
              accountStates={accountStates}
              accountSel={at('accounts')}
              treeRows={treeRows}
              findRows={findRows}
              projectSel={at('projects')}
              find={find}
              scope={scope}
              focus={keysAt}
              color={color}
              accountsW={leftW}
              projectsW={midW}
              height={bandH}
            />
            <ListColumn
              loaded={!!snap}
              work={work}
              done={done}
              workSel={at('work')}
              doneSel={at('done')}
              hover={hover}
              scope={scope}
              focus={keysAt}
              held={held}
              color={color}
              width={listW}
              workH={workH}
              doneH={doneH}
            />
          </Box>
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
