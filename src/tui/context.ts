import type { Dispatch, SetStateAction } from 'react'

import type { ProjectRow } from '../active.ts'
import type { Chime } from '../chime.ts'
import type { Account, Config } from '../config.ts'
import type { AccountState, Item, Snapshot } from '../model.ts'
import type { Report } from '../routines/index.ts'
import type { Row } from '../settings.ts'
import type { EmbeddedSession } from './embed.ts'
import type { Editing, Focus, Form, Hover, Panel, Reports, Sel } from './state.ts'

type Set<T> = Dispatch<SetStateAction<T>>

// Everything the actions and the key handlers work with: the app's state, what's derived from
// it, and where things are on screen. Built fresh by the app on every render.
export type AppCtx = {
  config: Config
  setConfig: Set<Config>
  save: (config: Config) => Promise<void>
  chime: Chime
  snap: Snapshot | null
  snapRef: { current: Snapshot | null }
  refresh: (withAuth: boolean) => Promise<void>
  askUsage: (account: Account) => Promise<void>
  suspendTerminal: (fn: () => Promise<void>) => Promise<void>
  exit: () => void

  focus: Focus
  setFocus: Set<Focus>
  // The list a conversation was opened from, to go back to.
  returnTo: Panel
  setReturnTo: Set<Panel>
  listFocus: Panel
  // The conversations kept open, the one last gone into first (see `admit` in embed.ts). The
  // ref is the same list as of the latest change, for callbacks that outlive a render.
  embeds: EmbeddedSession[]
  setEmbeds: Set<EmbeddedSession[]>
  embedsRef: { current: EmbeddedSession[] }
  // The open conversation the right panel is showing, if any.
  embed: EmbeddedSession | null
  // After stepping back, the conversation stays in the panel until the selection moves.
  embedShown: boolean
  setEmbedShown: Set<boolean>
  pick: (Sel & { active: boolean }) | null
  setPick: Set<(Sel & { active: boolean }) | null>
  sel: Record<Panel, number>
  hover: Hover
  setHover: Set<Hover>
  setSel: Set<Record<Panel, number>>
  scope: string | null
  setScope: Set<string | null>
  // The help screen (?), and how far it is scrolled.
  help: { scroll: number } | null
  setHelp: Set<{ scroll: number } | null>
  helpMax: number
  // The settings screen, and where its selection is.
  settings: { sel: number } | null
  setSettings: Set<{ sel: number } | null>
  settingRows: Row[]
  reloadSettings: () => Promise<void>
  message: string | null
  setMessage: Set<string | null>
  form: Form | null
  setForm: Set<Form | null>
  // What's typed in Projects, which finds as you type while it has the keys.
  query: string
  setQuery: Set<string>
  editing: Editing | null
  setEditing: Set<Editing | null>
  untrusted: { dir: string; draft: Editing } | null
  setUntrusted: Set<{ dir: string; draft: Editing } | null>
  // A routine's reports, when they have the keyboard, and the selected routine's reports.
  reports: Reports | null
  setReports: Set<Reports | null>
  routineReports: Report[]
  // A row to select on the list once it shows up there: a draft or routine just saved.
  setFollow: Set<string | null>

  work: Item[]
  done: Item[]
  projectKeys: string[]
  projectRows: ProjectRow[]
  accountStates: AccountState[]
  lists: Record<Panel, number>
  at: (p: Panel) => number
  selectedRow: ProjectRow | undefined
  selectedItem: Item | undefined
  scopeProject: string | null
  showingEmbed: boolean

  layout: {
    leftW: number
    midW: number
    rightW: number
    // Everything above the key bar.
    bodyH: number
    // The band of accounts and projects across the top of the left two columns, then the list.
    bandH: number
    doneH: number
    workH: number
    sessionCols: number
    sessionRows: number
  }
}
