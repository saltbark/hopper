import type { Key } from 'ink'

import { preferFirst, prefixesOf, setDefaultAccount, showPrefix, suggestName } from '../config.ts'
import { EFFORTS, MODELS, nextOf } from '../conversations.ts'
import type { Item } from '../model.ts'
import type { Actions } from './actions.ts'
import { copyToClipboard } from './clipboard.ts'
import type { AppCtx } from './context.ts'
import { backspace, insert, move, type EditorState, type Move } from './editor.ts'
import { keyToBytes } from './embed.ts'
import { rank } from './fuzzy.ts'
import { parseMouse, type MouseEvent } from './mouse.ts'
import { itemLines } from './panels/ItemRows.tsx'
import { workItemAt } from './panes/WorkRows.tsx'
import { asText, groupOf, typed, type Editing, type Hover, type Panel } from './state.ts'

type Handler = (input: string, key: Key) => void

export const QUIT_PROMPT = 'Press x again to quit.'

// Every key and mouse event, by what has the keyboard: the conversation, the input line, the
// editor, find, or the board. Built from the current context on every render.
export function makeInput(ctx: AppCtx, act: Actions): Handler {
  const { setMessage, setEditing, setForm, setSel } = ctx

  // ---- the mouse: the wheel scrolls what's under it; a click gives that panel the keyboard ----
  // In the list and done, the row under the pointer lights softly and a click selects it.
  // The help screen: when it is taller than the screen, j k and the arrows
  // scroll it and space a page; any other key closes it.
  const scrollHelp = (by: number) =>
    ctx.setHelp((h) => h && { scroll: Math.max(0, Math.min(ctx.helpMax, h.scroll + by)) })
  const onHelp: Handler = (input, key) => {
    if (!ctx.helpMax) return ctx.setHelp(null)
    if (input === 'j' || key.downArrow) return scrollHelp(1)
    if (input === 'k' || key.upArrow) return scrollHelp(-1)
    if (input === ' ' || key.pageDown) return scrollHelp(10)
    if (key.pageUp) return scrollHelp(-10)
    ctx.setHelp(null)
  }

  const onMouse = (events: MouseEvent[]) => {
    const { leftW, midW, bandH, workH, doneH, sessionCols, sessionRows } = ctx.layout
    const { embed, pick, focus } = ctx
    for (const ev of events) {
      // Over the help screen the wheel scrolls it and nothing else does anything.
      if (ctx.help) {
        if (ev.kind === 'wheel-up' || ev.kind === 'wheel-down')
          scrollHelp(ev.kind === 'wheel-up' ? -3 : 3)
        continue
      }
      // The band (accounts beside projects) over the list over done, then the right panel.
      const panel: Panel | 'right' =
        ev.x > leftW + midW
          ? 'right'
          : ev.y <= bandH
            ? ev.x <= leftW
              ? 'accounts'
              : 'projects'
            : ev.y <= bandH + workH
              ? 'work'
              : 'done'
      // The conversation's own cells: its top edge carries the title.
      const cellAt = {
        col: Math.max(0, Math.min(sessionCols - 1, ev.x - (leftW + midW) - 2)),
        row: Math.max(0, Math.min(sessionRows - 1, ev.y - 2)),
      }
      // The row under the pointer, drawn as the lists draw it: each frame's top edge, then its
      // lines. Headings and gaps in the list aren't rows.
      const rowAt = (): Hover => {
        if (panel === 'work') {
          const i = workItemAt(ctx.work, ctx.at('work'), workH, ev.y - bandH - 2)
          return i === null ? null : { panel, index: i }
        }
        if (panel !== 'done') return null
        const { start, slice } = itemLines(ctx.done, ctx.at('done'), doneH)
        const line = ev.y - bandH - workH - 2
        return line >= 0 && line < slice.length ? { panel, index: start + line } : null
      }
      if (ev.kind === 'move') {
        // Claude asks for every movement too, for its own hover.
        if (panel === 'right' && embed && ctx.showingEmbed)
          embed.forwardMouse('move', cellAt.col + 1, cellAt.row + 1)
        // Only a different row is a change, so the flood of movement doesn't redraw.
        const h = rowAt()
        ctx.setHover((cur) => (cur?.panel === h?.panel && cur?.index === h?.index ? cur : h))
        continue
      }
      const button = ev.kind === 'press' || ev.kind === 'drag' || ev.kind === 'release'
      if (embed && ctx.showingEmbed && button && (panel === 'right' || pick?.active)) {
        // A click in the conversation also gives it the keyboard, as a click on any panel does.
        if (ev.kind === 'press' && focus !== 'session' && !ctx.editing && !ctx.form && !ctx.find)
          act.enter(embed, focus)
        // Claude asks for the mouse and does its own selection; give it the events.
        if (embed.mouseWanted()) {
          embed.forwardMouse(
            ev.kind as 'press' | 'drag' | 'release',
            cellAt.col + 1,
            cellAt.row + 1,
          )
          continue
        }
        // Otherwise Hopper selects: drag inside the conversation, let go to copy.
        if (ev.kind === 'press') ctx.setPick({ a: cellAt, b: cellAt, active: true })
        else if (ev.kind === 'drag' && pick?.active) ctx.setPick({ ...pick, b: cellAt })
        else if (ev.kind === 'release' && pick?.active) {
          if (cellAt.col === pick.a.col && cellAt.row === pick.a.row) ctx.setPick(null)
          else {
            const text = embed.textBetween(pick.a, cellAt)
            copyToClipboard(text)
            ctx.setPick({ a: pick.a, b: cellAt, active: false })
            setMessage(`Copied ${text.length} characters.`)
          }
        }
        continue
      }
      if (ev.kind === 'wheel-up' || ev.kind === 'wheel-down') {
        const up = ev.kind === 'wheel-up'
        if (panel === 'right') {
          if (embed && ctx.showingEmbed) embed.wheel(up, ev.x - (leftW + midW) - 1, ev.y - 1)
          continue
        }
        // The rows move under the pointer; the next movement lights the new one.
        ctx.setHover(null)
        ctx.setEmbedShown(false)
        setSel((s) => ({
          ...s,
          [panel]: Math.max(0, Math.min(ctx.lists[panel] - 1, s[panel] + (up ? -1 : 1))),
        }))
      } else if (ev.kind === 'press' && !ctx.editing && !ctx.form && !ctx.find) {
        const h = rowAt()
        if (h) {
          // A click selects the row; a second click on it, once the list has the keyboard,
          // opens it, as ⏎ would.
          if (focus === h.panel && ctx.at(h.panel) === h.index)
            act.open((h.panel === 'work' ? ctx.work : ctx.done)[h.index])
          else {
            if (ctx.at(h.panel) !== h.index) ctx.setEmbedShown(false)
            setSel((s) => ({ ...s, [h.panel]: h.index }))
            act.go(h.panel)
          }
        } else if (panel !== 'right') act.go(panel)
        // The details of a conversation that isn't open: a click opens it, as ⏎ would.
        else if (!ctx.showingEmbed && ctx.selectedItem) act.open(ctx.selectedItem)
      }
    }
  }

  // ---- in a conversation, every key is Claude's, esc included ----
  // Stepping back to Hopper is ← at Claude's empty prompt, or ctrl+], which works from anywhere,
  // a Claude menu included. Both leave the conversation live; ⏎ goes back in. When the screen
  // shows the empty prompt, ← steps back at once and never reaches Claude; otherwise it goes
  // through, and Claude's agents screen (embed.ts) is the fallback. Claude's interrupt is
  // ctrl+c, or i on the list.
  const onSession: Handler = (input, key) => {
    const { embed } = ctx
    // ctrl+] arrives as the raw control character (0x1d).
    if (!embed || input === '\u001d' || (key.ctrl && input === ']')) return act.go(ctx.returnTo)
    if (key.leftArrow && !key.meta && !key.shift && !key.ctrl && embed.atEmptyPrompt())
      return act.go(ctx.returnTo)
    if (ctx.pick) ctx.setPick(null)
    embed.send(keyToBytes(input, key))
  }

  // ---- the one-line input in the key bar ----
  const onForm: Handler = (input, key) => {
    const form = ctx.form!
    if (key.escape) return setForm(null)
    if (
      form.kind === 'remove' ||
      form.kind === 'routine-remove' ||
      form.kind === 'draft-remove' ||
      form.kind === 'setting-remove'
    ) {
      if (input === 'y') void act.submitForm(form)
      else setForm(null)
      return
    }
    if (key.return) return void act.submitForm(form)
    if (key.backspace || key.delete) return setForm({ ...form, value: form.value.slice(0, -1) })
    if (typed(input, key)) setForm({ ...form, value: form.value + input })
  }

  // ---- the draft or routine editor ----
  const onPick = (e: Editing, input: string, key: Key) => {
    const list = rank(e.query, ctx.projectKeys)
    if (key.escape) return setEditing(null)
    if (key.upArrow) return setEditing({ ...e, pickSel: Math.max(0, e.pickSel - 1) })
    if (key.downArrow)
      return setEditing({ ...e, pickSel: Math.min(list.length - 1, e.pickSel + 1) })
    if (key.tab || key.return) {
      const chosen = list[Math.min(e.pickSel, list.length - 1)]
      if (!chosen) return setMessage('No project matches.')
      setEditing(null)
      return void act.saveEdit({ ...e, project: chosen }, `Moved to ${chosen}.`)
    }
    if (key.backspace || key.delete)
      return setEditing({ ...e, query: e.query.slice(0, -1), pickSel: 0 })
    if (typed(input, key))
      setEditing({ ...e, query: e.query + input.replace(/\s/g, ''), pickSel: 0 })
  }

  // esc saves and closes the editor; what was in it stays selected on the list, with its keys.
  const onWrite = (e: Editing, input: string, key: Key) => {
    if (key.escape) return void (e.routine ? act.keepRoutine(e) : act.keepDraft(e))
    const ed: EditorState = { text: e.text, cursor: e.cursor, anchor: e.anchor }
    const put = (n: EditorState) => setEditing({ ...e, ...n })
    const to = (how: Move) => put(move(ed, how, ctx.layout.rightW - 4, key.shift))
    if (key.return) return put(insert(ed, '\n'))
    // On a Mac, Backspace arrives as delete; Option+Backspace removes a word.
    if (key.backspace || key.delete) return put(backspace(ed, key.meta))
    // Terminal.app without "Use Option as Meta key" sends Option+Backspace as a plain delete.
    if (key.ctrl && input === 'w') return put(backspace(ed, true))
    if (key.leftArrow) return to(key.meta ? 'wordLeft' : key.ctrl ? 'home' : 'left')
    if (key.rightArrow) return to(key.meta ? 'wordRight' : key.ctrl ? 'end' : 'right')
    if (key.upArrow) return to(key.meta ? 'top' : 'up')
    if (key.downArrow) return to(key.meta ? 'bottom' : 'down')
    if (key.home) return to('home')
    if (key.end) return to('end')
    // What Mac terminals send for Option+←/→ and Cmd+←/→ by default.
    if (key.meta && (input === 'b' || input === 'f'))
      return to(input === 'b' ? 'wordLeft' : 'wordRight')
    if (key.ctrl && (input === 'a' || input === 'e')) return to(input === 'a' ? 'home' : 'end')
    if (typed(input, key)) put(insert(ed, asText(input)))
  }

  const onEditing: Handler = (input, key) => {
    const e = ctx.editing!
    if (e.stage === 'pick') return onPick(e, input, key)
    onWrite(e, input, key)
  }

  // ---- finding a project ----
  const onFind: Handler = (input, key) => {
    const find = ctx.find!
    const rows = ctx.findRows
    if (key.escape) return ctx.setFind(null)
    if (key.upArrow) return ctx.setFind({ ...find, sel: Math.max(0, find.sel - 1) })
    if (key.downArrow) return ctx.setFind({ ...find, sel: Math.min(rows.length - 1, find.sel + 1) })
    const row = rows[Math.min(find.sel, rows.length - 1)]
    if (key.return) {
      ctx.setFind(null)
      return row ? act.focusProject(row.key) : setMessage('No project matches.')
    }
    // tab starts a conversation there straight away, leaving the list as it was.
    if (key.tab) {
      if (!row) return setMessage('No project matches.')
      if (!row.isProject) return setMessage(`${row.key} is a folder. Pick a project in it.`)
      ctx.setFind(null)
      return act.newConversation(row.key)
    }
    if (key.backspace || key.delete) return ctx.setFind({ query: find.query.slice(0, -1), sel: 0 })
    if (typed(input, key)) ctx.setFind({ query: find.query + input.replace(/\s/g, ''), sel: 0 })
  }

  // ---- the settings screen ----
  const onSettings: Handler = (input, key) => {
    const rows = ctx.settingRows
    const sel = Math.min(ctx.settings!.sel, Math.max(0, rows.length - 1))
    const row = rows[sel]
    const to = (i: number) => ctx.setSettings({ sel: Math.max(0, Math.min(rows.length - 1, i)) })
    const section = (from: number, d: 1 | -1) => {
      let i = from + d
      while (i >= 0 && i < rows.length && rows[i]!.kind !== 'section') i += d
      return i
    }
    if (key.escape) return ctx.setSettings(null)
    if (input === 'J' || (key.shift && key.downArrow)) return to(section(sel, 1))
    if (input === 'K' || (key.shift && key.upArrow))
      return to(section(sel + 1, -1) === sel ? section(sel, -1) : section(sel + 1, -1))
    if (input === 'j' || key.downArrow) return to(sel + 1)
    if (input === 'k' || key.upArrow) return to(sel - 1)
    if (!row) return
    if (key.return) return act.settingsEdit(row)
    if (input === 'd') return act.settingsReset(row)
    if (input === 'o') return void act.settingsOpenFile(row.file)
    if (input === 'a') {
      const at = rows[section(sel + 1, -1)]
      if (at?.kind === 'section') return act.settingsAdd(at)
    }
    if (input === 'x') return ctx.message === QUIT_PROMPT ? ctx.exit() : setMessage(QUIT_PROMPT)
  }

  // ---- the board: panels, lists and accounts ----
  // A draft's and a routine's keys work on its row, without opening it: ⏎ is the only way into
  // the editor. They come before the board's letters, so p and s mean the row's here.
  const rowKeys = (it: Item | undefined): Record<string, () => unknown> => {
    const e = act.editingOf(it)
    if (!it || !e) return {}
    const r = e.routine
    const both: Record<string, () => unknown> = {
      s: () => (r ? act.runNow(e) : act.start(e)),
      m: () => {
        const model = nextOf(MODELS, e.model)
        return act.saveEdit({ ...e, model }, `Model: ${model ?? 'default'}.`)
      },
      e: () => {
        const effort = nextOf(EFFORTS, e.effort)
        return act.saveEdit({ ...e, effort }, `Effort: ${effort ?? 'default'}.`)
      },
      p: () => setEditing({ ...e, stage: 'pick', query: '', pickSel: 0 }),
      y: () => {
        copyToClipboard(e.text)
        setMessage(r ? 'Prompt copied.' : 'Draft copied.')
      },
    }
    if (r) {
      return {
        ...both,
        S: () => setForm({ kind: 'routine-schedule', value: r.schedule, editing: e, name: r.name }),
        P: () => {
          const enabled = !r.enabled
          const said = `${enabled ? 'Resumed' : 'Paused'} ${r.name}.`
          return act.saveEdit({ ...e, routine: { ...r, enabled } }, said)
        },
        d: () => setForm({ kind: 'routine-remove', name: r.name }),
      }
    }
    return {
      ...both,
      r: () => {
        if (!e.text.trim()) return setMessage('Prompt is empty.')
        const suggested = (e.text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
          .slice(0, 3)
          .join('-')
          .slice(0, 30)
        setForm({ kind: 'routine-name', value: suggested, editing: e })
      },
      d: () => setForm({ kind: 'draft-remove', id: e.id, name: it.name }),
    }
  }

  const onList = (panel: 'work' | 'done', input: string, key: Key) => {
    const list = panel === 'work' ? ctx.work : ctx.done
    const it = list[ctx.at(panel)]
    if (input === 'i') {
      if (!ctx.embed || ctx.embed.id !== it?.id) return setMessage('Open it first (⏎).')
      ctx.embed.send('\x1b')
      return setMessage('Sent esc to Claude.')
    }
    if (key.return) return act.open(it)
    if (input === 'd') return void act.markDone(it, panel === 'work')
  }

  const onAccounts = (input: string, key: Key) => {
    const { config } = ctx
    const a = ctx.accountStates[ctx.at('accounts')]?.account
    if (input === 'a') {
      const hint = ctx.snap?.accounts.find((s) => s.account.configDir === null)?.auth ?? null
      return setForm({
        kind: 'add-name',
        value: config.accounts.length ? '' : suggestName(hint, []),
      })
    }
    if (!a) return
    if (key.return) return void act.signIn(a)
    if (input === 'e') {
      const current = prefixesOf(config, a.name)
        .map((r) => showPrefix(r.prefix))
        .join(', ')
      return setForm({ kind: 'prefixes', name: a.name, value: current })
    }
    if (input === 'r') return setForm({ kind: 'label', name: a.name, value: a.label })
    if (input === '1')
      return void act.commit((c) => preferFirst(c, a.name), `${a.name} is first on its routes`)
    if (input === '*') {
      return void act.commit(
        (c) => setDefaultAccount(c, a.name),
        `${a.name} is the default: it runs anything no route names`,
      )
    }
    if (input === 'u') {
      setMessage(`Fetching ${a.name} usage…`)
      return void ctx.askUsage(a)
    }
    if (input === 'd') return setForm({ kind: 'remove', name: a.name })
  }

  const onBoard: Handler = (input, key) => {
    const focus = ctx.focus as Panel
    const own = focus === 'work' || focus === 'done' ? rowKeys(ctx.selectedItem)[input] : undefined
    if (own) return void own()
    if (key.escape) {
      if (focus !== 'projects') return act.go('projects')
      if (ctx.scope) ctx.setScope(null)
      return
    }
    if (key.tab) return act.newConversation()
    const jump: Record<string, Panel> = { p: 'projects', c: 'work', v: 'done', a: 'accounts' }
    // In Accounts, a is its own key again: add an account.
    if (jump[input] && !(input === 'a' && focus === 'accounts')) return act.go(jump[input])
    if (input === 'n') {
      // Straight to the first thing waiting on me.
      act.go('work')
      return setSel((s) => ({ ...s, work: 0 }))
    }
    if (input === 'f') return ctx.setFind({ query: '', sel: 0 })
    if (input === '?') return ctx.setHelp({ scroll: 0 })
    if (input === ',') return ctx.setSettings({ sel: 0 })
    // x sits next to z (fold), so quitting takes a second x straight after.
    if (input === 'x') return ctx.message === QUIT_PROMPT ? ctx.exit() : setMessage(QUIT_PROMPT)
    if (input === 'R') return void ctx.refresh(true)
    if (input === 'T' && ctx.untrusted) return void act.trust()

    // ← and → move between columns: projects and accounts, the list, the open conversation.
    // On the list, → is ⏎: it opens what's selected (or goes back into it), so ← → alone get
    // from the tree into a conversation and back.
    if (key.rightArrow) {
      if (focus === 'projects' || focus === 'accounts') return act.go('work')
      if (focus === 'work' || focus === 'done') {
        const it = (focus === 'work' ? ctx.work : ctx.done)[ctx.at(focus)]
        if (it) return act.open(it)
        if (ctx.embed) act.enter(ctx.embed, focus)
      }
      return
    }
    if (key.leftArrow) {
      if (focus === 'work' || focus === 'done') act.go('projects')
      return
    }
    const step = (d: number) => {
      ctx.setEmbedShown(false)
      setSel((s) => ({
        ...s,
        [focus]: Math.max(0, Math.min(ctx.lists[focus] - 1, ctx.at(focus) + d)),
      }))
    }
    // shift+↑↓ (or J K) jump: in Projects to the nearest folder, in the list to the next group.
    const jumpTo = (d: 1 | -1) => {
      const from = ctx.at(focus)
      const marks =
        focus === 'projects'
          ? ctx.treeRows.map((r) => r.hasChildren)
          : focus === 'work'
            ? ctx.work.map((w, i) => i === 0 || groupOf(w) !== groupOf(ctx.work[i - 1]!))
            : null
      if (!marks) return
      let i = from + d
      while (i >= 0 && i < marks.length && !marks[i]) i += d
      if (i < 0 || i >= marks.length) return
      ctx.setEmbedShown(false)
      setSel((s) => ({ ...s, [focus]: i }))
    }
    // option+↑↓ in Projects go a level up: ↑ to the parent folder, ↓ to the parent's next
    // sibling. At the top level there is nothing higher, so they move between top-level rows.
    const levelUp = (d: 1 | -1) => {
      const rows = ctx.treeRows
      const from = ctx.at('projects')
      const target = Math.max(0, (rows[from]?.depth ?? 0) - 1)
      let i = from + d
      while (i >= 0 && i < rows.length && rows[i]!.depth > target) i += d
      if (i < 0 || i >= rows.length) return
      ctx.setEmbedShown(false)
      setSel((s) => ({ ...s, projects: i }))
    }
    if (focus === 'projects' && key.meta && (key.upArrow || key.downArrow))
      return levelUp(key.downArrow ? 1 : -1)
    if (input === 'J' || (key.shift && key.downArrow)) return jumpTo(1)
    if (input === 'K' || (key.shift && key.upArrow)) return jumpTo(-1)
    if (input === 'j' || key.downArrow) return step(1)
    if (input === 'k' || key.upArrow) return step(-1)

    if (focus === 'projects') {
      const tree = ctx.selectedRow
      if (!tree) return
      if (key.return) return act.focusProject(tree.key)
      if (input === 'z' && tree.hasChildren) {
        ctx.setFolded((f) => {
          const next = new Set(f)
          if (next.has(tree.key)) next.delete(tree.key)
          else next.add(tree.key)
          return next
        })
      }
      return
    }
    if (focus === 'work' || focus === 'done') return onList(focus, input, key)
    onAccounts(input, key)
  }

  return (input, key) => {
    // Mouse events arrive as text; they are never keys, whatever has focus.
    const mouse = parseMouse(input)
    if (mouse) return onMouse(mouse)
    if (ctx.focus === 'session') return onSession(input, key)
    if (key.ctrl && input === 'c') return ctx.exit()
    // A message stays until the next keypress, then the key hints come back.
    if (ctx.message && !ctx.editing) setMessage(null)
    if (ctx.help) return onHelp(input, key)
    if (ctx.form) return onForm(input, key)
    if (ctx.settings) return onSettings(input, key)
    if (ctx.editing) return onEditing(input, key)
    if (ctx.find) return onFind(input, key)
    onBoard(input, key)
  }
}
