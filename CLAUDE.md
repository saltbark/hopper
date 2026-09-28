# hopper

A terminal app, open all day in its own window, for work handed to Claude Code agents across
several projects and several Claude logins. It shows each login's sessions and usage, the projects
in Hopper's home folder, a queue of what's running, and what needs me. It dispatches and attaches;
Claude Code does the work. Ink (React for the terminal) on Node, run from `dist/` so it opens fast.

The plan is `../proj_sb-meta/planning/saltbark/hopper/plan-v2.md`. Read it before changing behaviour.

## Things that are easy to get wrong

- **Never set `CLAUDE_CONFIG_DIR` for the default login.** With it set to `~/.claude`, the
  existing login reads as logged out. The default login (`config_dir = "default"`) runs with the
  variable unset; every other login gets it set to its own directory. See `src/claude.ts`.
- **`claude agents --json` has two shapes.** Background sessions carry `id` and `state`;
  interactive ones carry `pid` and `status`. Parse both.
- **Usage is a cache.** `cachedUsageUtilization` in the login's `.claude.json` can be days old.
  Always show its age next to the numbers.
- **No account is special in code.** Accounts and routes live in `accounts.toml` beside the
  config, written by Hopper (`src/config.ts` edits, `src/routing.ts` picks). A route maps a
  prefix to an ordered list of accounts; the first signed-in one with room runs the work.
- **`claude auth status` exits 1 when signed out** and creates the config dir as a side effect.
  Never call claude for an account whose directory doesn't exist (`isSetUp`).
- **A conversation is a Claude Code background session.** `tab` starts one with `claude --bg`
  in the project's run folder (`runIn`: a registry project's meta repo, a home project's home
  folder, else its own), with `hopperPrompt` appended so Claude knows the project's `_open.md`,
  then attaches. Claude reports a session that has answered as `done`; to Hopper that means
  _needs you_, until it's marked done in `<home>/state/done.json`. `claude --bg` refuses
  untrusted folders (`UntrustedError`); trust is inherited, so Hopper trusts its home once.
- **Conversations are embedded, not attached in place of Hopper.** `src/tui/embed.ts` runs
  `claude attach <id>` in a node-pty, feeds @xterm/headless, and draws its screen into the right
  panel; keys are translated back to bytes. Run attach in the session's own cwd: Claude's agents
  view (its ← gesture) opens where attach runs, and seeing that screen is how Hopper knows to hand
  the keyboard back. Pass env with CLAUDE_CONFIG_DIR deleted, never set to undefined (node-pty
  turns it into the string "undefined"). node-pty's `spawn-helper` needs +x (postinstall).
- **Hopper turns on mouse reporting** (SGR, `src/tui/mouse.ts`) so the wheel arrives as events
  rather than arrow keys. Ink hands them over as text (`[<64;x;yM`); parse them before anything
  treats them as keys. Turn reporting off around anything that takes over the terminal. It asks
  for every movement (1003), for hover: only set state when the row under the pointer changes.
  Finding that row reuses the lists' own windowing (`workItemAt`, `itemLines`), so a change to how
  a list lays out its lines carries over to the mouse.
- **Claude does its own mouse selection** (it asks for "any" mouse tracking) and copies with OSC 52. The headless terminal has no clipboard, so `embed.ts` catches OSC 52 and Hopper copies.
  Hopper's own drag-select is only the fallback for programs that don't want the mouse.
- **Usage comes from `claude -p /usage`**, which is answered locally at no cost and refreshes the
  cache. Never read login tokens for it.
- **Routines** (`src/routines/`): files in `<home>/routines/`, runs in `<home>/state/runs.jsonl`,
  results in `<home>/routines/<name>/runs/`. launchd runs `hopper run <name>`; `syncLaunchd`
  keeps `~/Library/LaunchAgents/com.saltbark.hopper.*` in step (tests set `HOPPER_LAUNCHD_DIR`
  and `HOPPER_NO_LAUNCHCTL`). A run gets `--add-dir` on its routine folder so it can write its
  result without asking. The model and routine of a conversation Hopper started are in
  `<home>/state/conversations.json`; Claude Code doesn't report them.
- **Registry projects are read, never copied.** A `[[source]]` in `projects.toml` imports a meta
  repo's `paths.local` on every load (`loadSource` in `src/home.ts`); those projects carry
  `meta`, their open file sits in the meta repo, and `hopperPrompt` defers to that repo's planning
  rules rather than Hopper's own `## Open` shape. `extraDirs` gives the session `--add-dir` on the
  planning folder. Paths go through `realpath`: Claude reports a session's physical cwd.
- **Many projects share one run folder**, so a session's cwd can't say which project it is for.
  The project Hopper recorded when it started it (`conversations.json`) wins; cwd matching is the
  fallback, for sessions Hopper didn't start. `extraDirs` adds the project's own folder when it
  resolves outside the run folder (it does, through the meta repo's `projects/` symlink).
- **Keys are letters and esc.** Inside an embedded conversation every key is Claude's, esc
  included; the way back to Hopper is Claude's own ← at the empty prompt, or ctrl+] (the one Ctrl
  binding), and both leave it live. Claude's interrupt is ctrl+c (passed through) or `i` from the
  list. No other Ctrl or Cmd bindings. What the
  keys do is described once, in `src/tui/keymap.ts` (the key bar and `?` both read it); a key
  added or changed in `keys.ts` gets its line there too. `esc` goes up a level; the top level is
  a menu of single letters.

## Where things are

- `src/cli.tsx`: the `hopper` command (`init`, `status`, `login`, `run`, `routines`, and the TUI).
- `src/tui/App.tsx`: composition only. State, the lists worked out from it, the layout, render.
  Don't put behaviour back here.
- `src/tui/actions.ts`: what the app does (`makeActions(ctx)`). `src/tui/keys.ts`: what each key
  and mouse event does, one handler per mode (`makeInput(ctx, actions)`). Both take the `AppCtx`
  from `src/tui/context.ts`, rebuilt every render.
- `src/tui/hooks.ts`: polling (`useSnapshot`), usage, draft autosave, a project's open items.
- `src/tui/panes/` (the columns, draft editor, picker, conversation, help, key bar) and
  `src/tui/panels/` (rows, accounts, and `detail/` for the right panel). Row components are
  memoized; keep their props stable.
- `src/settings.ts`: the settings screen's model (every setting's value, set or default, and
  `projects.toml` as a document to edit); `src/tui/settingsActions.ts` writes changes back, and
  checks a `projects.toml` loads before keeping it; `src/tui/panes/SettingsPane.tsx` draws it. A
  new setting in any of the three files gets a row in `buildRows`.
- `src/fsutil.ts` (`readIfThere`, `writeAtomic`) and `src/frontmatter.ts`: use these for any
  state file rather than writing fs code again. Tests share `test/helpers.ts` (`fakeClaude`).

## Its own rules

This project owns its architecture, stack, deployment, and naming. It is symlinked into the
`sb-meta` orchestration repo for convenience, which implies nothing about sharing anything with
the projects sitting next to it. Do not carry a pattern into this repo from another one merely
because it was nearby.

The one exception: if this project is TypeScript, the shared toolchain conventions in
`../proj_sb-meta/conventions/toolchain/` apply. Copy those lint, format, and test configs rather
than forking them; `just adopt-toolchain saltbark/hopper` does it. Nothing else in that repo governs this
one.

Plans live in `../proj_sb-meta/planning/saltbark/hopper/`.
Read `_open.md` there before starting work: it is what's left, and its **Now** line says what's in
flight. When something ships, move its line to `_done.md` in the same session.
