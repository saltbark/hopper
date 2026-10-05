import { Box, useApp, useInput, useWindowSize } from 'ink'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { activeRows, rollUp, type ProjectStat } from '../active.ts'
import { caffeinate, canKeepAwake, type KeepAwake } from '../awake.ts'
import { playChime, type Chime } from '../chime.ts'
import { defaultsFor, DIM_DEFAULT, prefixesOf, saveAccounts, type Config } from '../config.ts'
import {
  draftSessionId,
  gather,
  inScope,
  OTHER,
  routineSessionId,
  waitsOnMe,
  type Item,
} from '../model.ts'
import { lastRan } from '../routines/index.ts'
import { buildRows } from '../settings.ts'
import { makeActions } from './actions.ts'
import type { AppCtx } from './context.ts'
import { rank, withFolders } from './fuzzy.ts'
import {
  useChime,
  useDraftAutosave,
  useOpenConversations,
  useSettingsDoc,
  useProjectItems,
  useAutopilot,
  useAwake,
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
  type Focus,
  type Hover,
  type Form,
  type Panel,
  type Reports,
  type Sel,
} from './state.ts'
import { setDim } from './theme.ts'

export type { Loader }
export type Saver = typeof saveAccounts

const noTitle = () => {}

const LISTED = new Set<Item['where']>(['queue', 'needs', 'routine'])
// Most recently active first, except routines: the soonest to run first, then the ones with no
// next run (paused, run by hand), each by name.
export const byGroup = (a: Item, b: Item) =>
  groupRank(groupOf(a)) - groupRank(groupOf(b)) ||
  (a.kind === 'routine' && b.kind === 'routine'
    ? (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) || a.name.localeCompare(b.name)
    : b.activeAt - a.activeAt)

export function App({
  config: initialConfig,
  load = gather,
  save = saveAccounts,
  chime = playChime,
  setTitle = noTitle,
  onFocus,
  // Routines on their schedule and queued drafts, while the app is open. Tests turn it off
  // (HOPPER_NO_AUTOPILOT, in vitest.config.ts) unless they're about it.
  autopilot = !process.env['HOPPER_NO_AUTOPILOT'],
  // What z holds the Mac awake with (awake.ts); none off macOS. Tests pass their own.
  keepAwake = canKeepAwake ? caffeinate : null,
}: {
  config: Config
  load?: Loader
  save?: Saver
  chime?: Chime
  // Writes the terminal tab's title; tests leave it out.
  setTitle?: (text: string) => void
  // Told the panel with the keyboard whenever it changes, for tests: the screen shows it only in
  // colour.
  onFocus?: (panel: string) => void
  autopilot?: boolean
  keepAwake?: KeepAwake | null
}) {
  const { exit, suspendTerminal: suspendInk } = useApp()
  const { columns, rows } = useWindowSize()

  const [config, setConfig] = useState(initialConfig)
  // Before anything draws: the panels without the keys are darkened by this much.
  setDim(config.dim ?? DIM_DEFAULT)
  const [focus, setFocus] = useState<Focus>('work')
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
  // Which item each re-sorting list has selected, and the row it was on then.
  const [pinned, setPinned] = useState<
    Record<'work' | 'done', { key: string | null; at: number } | null>
  >({ work: null, done: null })
  const [hover, setHover] = useState<Hover>(null)
  const [scope, setScope] = useState<string | null>(null)
  const [help, setHelp] = useState<{ scroll: number } | null>(null)
  const [settings, setSettings] = useState<{ sel: number } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Editing | null>(null)
  // A draft Claude refused to start because its folder isn't trusted yet; T trusts and starts it.
  const [untrusted, setUntrusted] = useState<{ dir: string; draft: Editing } | null>(null)
  const [follow, setFollow] = useState<string | null>(null)
  const [reportsFocus, setReportsFocus] = useState<Reports | null>(null)

  const { snap, snapRef, error, refresh, patch } = useSnapshot(config, load)
  const { usageText, askUsage } = useUsage(config.home, snapRef, refresh)
  useDraftAutosave(editing, config.home)
  useAutopilot(config, snap, refresh, setMessage, autopilot)
  const { awake, toggleAwake } = useAwake(config.home, keepAwake)
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

  // Each project's numbers, and when something last happened there.
  const projectStats = useMemo<ProjectStat[]>(() => {
    if (!snap) return []
    const count = (key: string, w: Item['where']) =>
      snap.items.filter((i) => i.key === key && i.where === w).length
    const last = new Map<string, number>()
    for (const i of snap.items) last.set(i.key, Math.max(last.get(i.key) ?? 0, i.activeAt))
    return snap.projects.map((p) => ({
      key: p.key,
      counts: {
        open: snap.openCounts.get(p.key) ?? 0,
        run: count(p.key, 'queue'),
        you: snap.items.filter((i) => i.key === p.key && waitsOnMe(i)).length,
      },
      last: last.get(p.key) ?? 0,
    }))
  }, [snap])
  // Projects: while it has the keys and something is typed, every project and folder that
  // matches; otherwise the ones with something going on.
  const finding = focus === 'projects' ? query : ''
  const allKeys = useMemo(() => withFolders(projectKeys), [projectKeys])
  const projectRows = useMemo(
    () =>
      finding
        ? rank(finding, allKeys).map((key) => rollUp(key, projectStats))
        : activeRows(projectStats, scope, snap?.at ?? 0),
    [finding, allKeys, projectStats, scope, snap],
  )

  const accountStates = useMemo(
    () =>
      config.accounts.map(
        (a) => snap?.accounts.find((s) => s.account.name === a.name) ?? blankState(a),
      ),
    [config, snap],
  )
  const lists: Record<Panel, number> = {
    projects: projectRows.length,
    work: work.length,
    done: done.length,
    accounts: accountStates.length,
  }
  const at = (p: Panel) => Math.max(0, Math.min(sel[p], lists[p] - 1))
  // The conversations and Done lists re-sort as things change state, so the selection follows
  // the item, not the row. Moving the selection re-pins it; while it hasn't moved, a pinned item
  // that went elsewhere in the list is found again. One that left the list leaves the row
  // selected, which is now its neighbour.
  for (const [p, list] of [
    ['work', work],
    ['done', done],
  ] as const) {
    const pin = pinned[p]
    const key = list[at(p)]?.sessionId ?? null
    if (pin && pin.at === sel[p] && pin.key !== key) {
      const i = list.findIndex((w) => w.sessionId === pin.key)
      if (i >= 0) {
        setSel((s) => ({ ...s, [p]: i }))
        setPinned((x) => ({ ...x, [p]: { key: pin.key, at: i } }))
        continue
      }
    }
    if (pin?.key !== key || pin?.at !== sel[p])
      setPinned((x) => ({ ...x, [p]: { key, at: sel[p] } }))
  }
  const selectedRow = projectRows[at('projects')]
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
  // The routine's list has the keyboard only while its routine is the one selected. -1 is its
  // first line, the prompt.
  const reports =
    reportsFocus && reportsFocus.routine === selectedRoutine?.name
      ? { ...reportsFocus, sel: Math.min(reportsFocus.sel, routineReports.length - 1) }
      : null
  const selectedReport = reports ? routineReports[reports.sel] : undefined
  // While you're in a conversation, or just stepped back from one, the panel shows the one you
  // went into; otherwise whichever open one the selected row is. Stepped back, it only shows
  // the one you went into while no other row is selected: when that one moves (to Archived, say)
  // and the selection lands on its neighbour, the panel follows the selection.
  const front = embeds[0]
  const frontListed = !!front && [...work, ...done].some((i) => i.id === front.id)
  const embed =
    focus === 'session' || (embedShown && (!selectedItem || !frontListed))
      ? (front ?? null)
      : (embeds.find((e) => !!selectedItem?.id && e.id === selectedItem.id) ?? null)
  const showingEmbed = !!embed
  // The blue edge is where the keys go: nowhere on the left while the editor has them.
  const keysAt = editing || reports ? null : focus
  useEffect(() => onFocus?.(focus === 'work' ? 'conversations' : focus), [focus, onFocus])
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
  // The model and effort a draft or routine in a project gets when it picks none.
  const defaultsIn = (key: string | undefined) =>
    defaultsFor(
      config,
      snap?.projects.find((p) => p.key === key),
    )
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
    defaults: defaultsIn(selectedItem?.key),
    setting: settings ? (settingRows[settings.sel] ?? null) : undefined,
    reports: reports
      ? {
          reading: !!reports.open,
          onPrompt: reports.sel < 0,
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
  // The band is as tall as its cap whatever Projects lists, so the list under it stays put as
  // you type. Past the cap, projects and accounts scroll.
  const bandH = Math.max(8, Math.min(16, Math.round(bodyH * 0.3)))
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
    chime,
    snap,
    snapRef,
    refresh,
    patch,
    askUsage,
    suspendTerminal,
    exit,
    awake,
    toggleAwake,
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
    query,
    setQuery,
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
    projectRows,
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
        <DraftPane
          editing={editing}
          defaults={defaultsIn(editing.project)}
          width={rightW}
          height={bodyH}
        />
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
        ? {
            routine: r,
            reports: routineReports,
            last: lastRan(snap.runs, r.name),
            account: selectedItem?.account,
            now: snap.at,
            defaults: defaultsIn(r.project),
          }
        : undefined
    return (
      <Frame
        title={detailTitle(selectedItem, project, account)}
        width={rightW}
        height={bodyH}
        focused={!!reports}
        dimmed={!reports}
      >
        <Detail
          item={selectedItem}
          draft={draft}
          project={project}
          account={account}
          openItems={selectedItem ? openItems : undefined}
          routine={routine}
          reportSel={reports?.sel}
          defaults={here.defaults}
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
              projectRows={projectRows}
              projectSel={at('projects')}
              query={finding}
              scope={scope}
              hover={hover}
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
        query={finding}
        here={here}
        message={message}
        error={error}
        awake={awake}
      />
    </Box>
  )
}
