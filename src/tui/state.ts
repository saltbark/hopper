import type { Account } from '../config.ts'
import type { Draft } from '../drafts.ts'
import type { AccountState, Item } from '../model.ts'
import type { Routine } from '../routines/index.ts'

// The app's own vocabulary: panels, the list's groups, the input line, and the draft editor.

export type Panel = 'projects' | 'work' | 'done' | 'accounts'
// 'session' is the embedded conversation: while it has focus, every key goes to Claude.
export type Focus = Panel | 'session'

// The row under the pointer in any of the panels' lists, lit more softly than the selection.
export type Hover = { panel: Panel; index: number } | null

export const PANELS: Panel[] = ['projects', 'work', 'done', 'accounts']

// Everything not done is one list, in these groups, in this order. J K jump between them; the
// letters on the list act on the selected row instead.
export type Group = 'waiting' | 'draft' | 'proposed' | 'running' | 'routines' | 'next'
export const GROUPS: { id: Group; label: string }[] = [
  { id: 'waiting', label: 'waiting on you' },
  { id: 'draft', label: 'drafts' },
  // Drafts an agent wrote for me to approve (the groomer, a review, a chain past its depth).
  { id: 'proposed', label: 'proposed' },
  { id: 'running', label: 'running' },
  // Prompts that run on a schedule; each run is its own conversation.
  { id: 'routines', label: 'routines' },
  // Queued drafts: they start on their own, unattended, when ready and an account has room.
  { id: 'next', label: 'up next' },
]
export const groupOf = (i: Item): Group =>
  i.kind === 'draft'
    ? i.queue
      ? 'next'
      : i.proposed
        ? 'proposed'
        : 'draft'
    : i.kind === 'routine'
      ? 'routines'
      : i.where === 'queue'
        ? 'running'
        : 'waiting'
export const groupRank = (g: Group) => GROUPS.findIndex((x) => x.id === g)

// A conversation before it starts, or a routine's prompt, open in the editor. Writing is roomy
// (⏎ is a new line); esc saves it and closes the editor, leaving it selected on the list, where
// its keys are. 'pick' is choosing another project for one, from the list.
export type Editing = {
  id: string
  project: string
  text: string
  // The editor's cursor and selection anchor (see editor.ts).
  cursor: number
  anchor: number | null
  created: number
  stage: 'write' | 'pick'
  query: string
  pickSel: number
  // What it starts with; undefined is Claude's default.
  model?: string | undefined
  effort?: string | undefined
  // Set when this is a routine's prompt rather than a draft.
  routine?: { name: string; schedule: string; enabled: boolean; check?: string } | undefined
  // A draft's overnight fields, carried through the editor unchanged.
  extra?: DraftExtra | undefined
}

export type DraftExtra = Pick<Draft, 'queue' | 'after' | 'done' | 'proposed' | 'depth'>

// One line of input at a time, in the key bar. Removing is a yes/no.
export type Form =
  | { kind: 'add-name'; value: string }
  | { kind: 'add-dir'; name: string; value: string }
  | { kind: 'prefixes'; name: string; value: string }
  | { kind: 'label'; name: string; value: string }
  | { kind: 'remove'; name: string }
  | { kind: 'routine-name'; value: string; editing: Editing }
  | { kind: 'routine-schedule'; value: string; editing: Editing; name: string }
  | { kind: 'routine-remove'; name: string }
  | { kind: 'draft-remove'; id: string; name: string }
  | { kind: 'setting'; name: string; value: string; id: string }
  | { kind: 'setting-remove'; name: string; id: string }
  | { kind: 'setting-add-source'; value: string }
  | { kind: 'setting-add-project'; value: string }

export const FORM_PROMPT: Record<Form['kind'], string> = {
  'add-name': 'short name for this account',
  'add-dir': 'its config directory ("default" for the login Claude uses with no CLAUDE_CONFIG_DIR)',
  prefixes: 'prefixes it runs, comma separated (* for everything)',
  label: 'label',
  remove: '',
  'routine-name': 'name this routine (lowercase, hyphens)',
  'routine-schedule':
    'when it runs: daily 7:00 · weekdays 7:00, 13:00 · weekly mon 9:00 · monthly 1st 9:00 · blank for run-now only',
  'routine-remove': '',
  'draft-remove': '',
  setting: 'new value (blank for the default)',
  'setting-remove': '',
  'setting-add-source': 'prefix and meta repo folder, like: kf ~/Workspace/kf-meta',
  'setting-add-project':
    'project key: one a source lists, to set things for it, or a new meta/ key for the home folder',
}

// Finding a project by typing part of its name.
export type Find = { query: string; sel: number }

// Text selected in the conversation with the mouse, in its own cells.
export type Sel = { a: { col: number; row: number }; b: { col: number; row: number } }

// A routine's reports with the keyboard in the right panel: which is selected, and the one open
// for reading, scrolled this far. The routine stays selected on the list underneath.
export type Reports = {
  routine: string
  sel: number
  open: { path: string; text: string; scroll: number } | null
}

// A blank editor for a new draft.
export const newEditing = (
  fields: Pick<Editing, 'id' | 'project' | 'text' | 'created'> & Partial<Editing>,
): Editing => ({
  cursor: fields.text.length,
  anchor: null,
  stage: 'write',
  query: '',
  pickSel: 0,
  ...fields,
})

// The routine a routine editor describes.
export const toRoutine = (
  e: Editing,
  name: string,
  schedule: string,
  enabled: boolean,
): Routine => ({
  name,
  project: e.project,
  schedule,
  enabled,
  prompt: e.text,
  ...(e.model ? { model: e.model } : {}),
  ...(e.effort ? { effort: e.effort } : {}),
  ...(e.routine?.check ? { check: e.routine.check } : {}),
})

// The draft as it is saved to disk.
export const toDraft = (e: Editing, updated: number): Draft => ({
  id: e.id,
  project: e.project,
  text: e.text,
  created: e.created,
  updated,
  ...(e.model ? { model: e.model } : {}),
  ...(e.effort ? { effort: e.effort } : {}),
  ...e.extra,
})

// "sonnet · high", or "default model" when nothing is chosen.
export const modelLabel = (model?: string, effort?: string) =>
  [model ?? 'default model', effort].filter(Boolean).join(' · ')

// Typed keys that count as text: printable, pasted newlines become real ones.
export const typed = (input: string, key: { ctrl: boolean; meta: boolean; tab: boolean }) =>
  !!input &&
  !key.ctrl &&
  !key.meta &&
  !key.tab &&
  [...input].every((ch) => ch >= ' ' || ch === '\r' || ch === '\n')
export const asText = (input: string) => input.replace(/\r\n?/g, '\n')

// Handlers stamp times through this, so render stays pure.
export const now = () => Date.now()

// An account Hopper hasn't heard from yet.
export const blankState = (account: Account): AccountState => ({
  account,
  auth: null,
  authError: null,
  usage: null,
  sessionError: null,
  counts: { queue: 0, needs: 0, done: 0, live: 0 },
})
