// What the keys do, in one place: the key bar shows the ones for where you are, and the help
// screen (?) shows those first and then all of them. keys.ts is what acts on them; keep the two
// in step.

import type { Item } from '../model.ts'
import type { Row } from '../settings.ts'
import type { TreeRow } from '../tree.ts'
import { GROUPS, type Editing, type Focus } from './state.ts'

export type Hint = [key: string, does: string]

// Where the keyboard is, as much as the hints need to know.
export type Here = {
  focus: Focus
  row?: TreeRow | undefined
  item?: Item | undefined
  scope: string | null
  // The selected item's conversation is the one showing on the right.
  embedOpen: boolean
  // The right panel shows the summary of what's selected, which lists its own keys.
  summaryShown: boolean
  untrusted: boolean
  editing: Editing | null
  // Set while the settings screen is open: the row selected there.
  setting?: Row | null | undefined
}

export const ANYWHERE: Hint[] = [
  ['?', 'all keys'],
  ['f', 'find a project'],
  ['tab', 'new conversation'],
  ['n', 'next waiting on you'],
  ['p c v a', 'projects, conversations, done, accounts'],
  ['← →', 'between columns'],
  ['s', 'settings'],
  ['R', 'refresh'],
  ['esc', 'back'],
  ['x x', 'quit'],
]

const GROUP_KEYS: Hint = [GROUPS.map((g) => g.key).join(' '), GROUPS.map((g) => g.label).join(', ')]

// Every key of each panel, for the help screen.
export const PANEL_KEYS: [label: string, hints: Hint[]][] = [
  [
    'projects',
    [
      ['j k', 'move'],
      ['J K', 'nearest folder (or shift+↑↓)'],
      ['option+↑↓', 'up a level: the parent, the next one after it'],
      ['⏎', 'focus it (the list narrows to it)'],
      ['tab', 'new conversation here'],
      ['z', 'fold a folder'],
      ['esc', 'show every project again'],
    ],
  ],
  [
    'the list',
    [
      ['j k', 'move'],
      ['J K', 'next group (or shift+↑↓)'],
      ['⏎ →', 'open it here, or go back into it'],
      ['m', 'mark done'],
      ['i', 'send esc to its conversation'],
      GROUP_KEYS,
    ],
  ],
  [
    'done',
    [
      ['⏎ →', 'open it here'],
      ['m', 'bring it back'],
    ],
  ],
  [
    'accounts',
    [
      ['⏎', 'sign in'],
      ['a', 'add (once you are in Accounts)'],
      ['e', 'prefixes it runs'],
      ['1', 'make it first on them'],
      ['*', 'make it the default'],
      ['u', 'fresh usage'],
      ['r', 'rename'],
      ['d', 'remove'],
    ],
  ],
]

export const SETTINGS_KEYS: Hint[] = [
  ['j k', 'move'],
  ['J K', 'sections'],
  ['⏎', 'edit, or next choice'],
  ['d', 'back to the default, or remove'],
  ['a', 'add to this section'],
  ['o', 'open the file in $EDITOR'],
  ['esc', 'close'],
]

function settingKeys(row: Row | null): Hint[] {
  const hints: Hint[] = []
  if (row?.kind === 'setting') {
    if (row.edit.type === 'text') hints.push(['⏎', 'edit'])
    if (row.edit.type === 'choice') hints.push(['⏎', 'next choice'])
    if (row.isSet && row.edit.type !== 'readonly') hints.push(['d', 'default'])
  }
  if (row?.kind === 'group' && row.remove) hints.push(['d', 'remove'])
  hints.push(['a', 'add'], ['J K', 'sections'], ['o', 'open the file'], ['esc', 'close'])
  return hints
}

export const CONVERSATION_KEYS: Hint[] = [
  ['← ctrl+]', 'back to Hopper, leaving it open (⏎ goes back in)'],
  ['esc', "Claude's"],
  ['ctrl+c', 'interrupt Claude'],
]

export const WRITING_KEYS: Hint[] = [
  ['⏎', 'new line'],
  ['option+arrows', 'by word'],
  ['option+⌫ ctrl+w', 'delete a word'],
  ['cmd+arrows', 'to the ends'],
  ['shift', 'selects'],
  ['esc', 'decide'],
]

// For the help screen, with no draft open, the model and effort read "default".
type Choices = Partial<Pick<Editing, 'model' | 'effort' | 'routine'>>

export function draftKeys(e: Choices): Hint[] {
  return [
    ['s', 'start it'],
    ['r', 'make it a routine'],
    ['m', `model (${e.model ?? 'default'})`],
    ['e', `effort (${e.effort ?? 'default'})`],
    ['p', 'move'],
    ['y', 'copy'],
    ['x', 'throw away'],
    ['esc', 'keep as draft'],
    ['?', 'all keys'],
  ]
}

export function routineKeys(e: Choices): Hint[] {
  const r = e.routine
  return [
    ['s', 'run now'],
    ['S', `schedule (${r?.schedule || 'none'})`],
    ['P', r?.enabled === false ? 'resume' : 'pause'],
    ['m', `model (${e.model ?? 'default'})`],
    ['e', 'effort'],
    ['p', 'project'],
    ['x', 'remove'],
    ['esc', 'save'],
    ['?', 'all keys'],
  ]
}

// The keys that do something for what is selected right now.
export function hereKeys(h: Here): { label: string; hints: Hint[] } {
  const trust: Hint[] = h.untrusted ? [['T', 'trust the folder and start']] : []
  if (h.setting !== undefined) return { label: 'settings', hints: settingKeys(h.setting) }
  if (h.editing) {
    const e = h.editing
    if (e.stage === 'write') return { label: 'writing', hints: WRITING_KEYS }
    return e.routine
      ? { label: 'a routine', hints: routineKeys(e) }
      : { label: 'a draft', hints: draftKeys(e) }
  }
  if (h.focus === 'session') return { label: 'a conversation', hints: CONVERSATION_KEYS }
  if (h.focus === 'projects') {
    const hints: Hint[] = [
      ['⏎', 'focus'],
      ['tab', 'new here'],
    ]
    if (h.row?.hasChildren) hints.push(['z', h.row.folded ? 'unfold' : 'fold'])
    hints.push(['J K', 'folders'], ['opt+↑↓', 'levels'])
    if (h.scope) hints.push(['esc', 'show every project'])
    return { label: 'projects', hints: [...trust, ...hints] }
  }
  if (h.focus === 'accounts') return { label: 'accounts', hints: PANEL_KEYS[3]![1] }
  const it = h.item
  const done = h.focus === 'done'
  const hints: Hint[] = []
  if (it?.kind === 'draft') hints.push(['⏎', 'keep writing'])
  else if (it?.kind === 'routine') hints.push(['⏎', 'edit the prompt'])
  else if (it?.id) {
    if (h.embedOpen) hints.push(['⏎ →', 'into the conversation'], ['i', 'interrupt'])
    else hints.push(['⏎ →', 'open it here'])
  }
  if (it) hints.push(['m', done ? 'bring it back' : 'mark done'])
  if (!done) hints.push(['J K', 'groups'], [GROUP_KEYS[0], 'jump to a group'])
  return { label: done ? 'done' : 'the list', hints: [...trust, ...hints] }
}

// Keys each summary on the right lists itself (panels/detail/), so the key bar leaves them out.
function summaryKeys(h: Here): Set<string> {
  if (h.focus === 'projects') return new Set(['⏎', 'tab', 'z'])
  if (h.focus === 'accounts') return new Set(PANEL_KEYS[3]![1].map(([k]) => k))
  if (h.item?.kind === 'routine') return new Set(['⏎', 's'])
  if (h.item?.kind === 'draft') return new Set(['⏎'])
  if (h.item?.id) return new Set(['⏎', 'm', 'i'])
  return new Set()
}

// The key bar: the keys for where you are that nothing on screen already shows. Group letters
// are on the list's headings; a summary on the right lists its own.
export function barKeys(h: Here): Hint[] {
  const { hints } = hereKeys(h)
  if (h.editing || h.focus === 'session' || h.setting !== undefined) return hints
  const shown = h.summaryShown ? summaryKeys(h) : new Set<string>()
  // "⏎ →" with ⏎ already on the summary is just "→".
  return hints
    .filter(([k]) => k !== GROUP_KEYS[0])
    .map(([k, d]): Hint => [
      k
        .split(' ')
        .filter((t) => !shown.has(t))
        .join(' '),
      d,
    ])
    .filter(([k]) => k)
}
