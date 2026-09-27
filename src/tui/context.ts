import type { Dispatch, SetStateAction } from 'react'

import type { Account, Config } from '../config.ts'
import type { AccountState, Item, Snapshot } from '../model.ts'
import type { Routine } from '../routines/index.ts'
import type { TreeRow } from '../tree.ts'
import type { EmbeddedSession } from './embed.ts'
import type { Editing, Find, Focus, Form, Panel, Sel } from './state.ts'

type Set<T> = Dispatch<SetStateAction<T>>

// Everything the actions and the key handlers work with: the app's state, what's derived from
// it, and where things are on screen. Built fresh by the app on every render.
export type AppCtx = {
  config: Config
  setConfig: Set<Config>
  save: (config: Config) => Promise<void>
  syncSchedule: (config: Config, routines: Routine[]) => Promise<unknown>
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
  embed: EmbeddedSession | null
  setEmbed: Set<EmbeddedSession | null>
  // After esc, the conversation stays in the panel until the selection moves.
  embedShown: boolean
  setEmbedShown: Set<boolean>
  pick: (Sel & { active: boolean }) | null
  setPick: Set<(Sel & { active: boolean }) | null>
  sel: Record<Panel, number>
  setSel: Set<Record<Panel, number>>
  scope: string | null
  setScope: Set<string | null>
  setFolded: Set<globalThis.Set<string>>
  help: boolean
  setHelp: Set<boolean>
  message: string | null
  setMessage: Set<string | null>
  form: Form | null
  setForm: Set<Form | null>
  find: Find | null
  setFind: Set<Find | null>
  editing: Editing | null
  setEditing: Set<Editing | null>
  untrusted: { dir: string; draft: Editing } | null
  setUntrusted: Set<{ dir: string; draft: Editing } | null>

  work: Item[]
  done: Item[]
  projectKeys: string[]
  treeRows: TreeRow[]
  findRows: TreeRow[]
  accountStates: AccountState[]
  lists: Record<Panel, number>
  at: (p: Panel) => number
  selectedRow: TreeRow | undefined
  selectedItem: Item | undefined
  scopeProject: string | null
  showingEmbed: boolean

  layout: {
    leftW: number
    midW: number
    rightW: number
    accountsH: number
    workH: number
    sessionCols: number
    sessionRows: number
  }
}
