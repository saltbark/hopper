# hopper

A terminal app, open all day in its own window, for work handed to Claude Code agents across
several projects and several Claude logins. It shows each login's sessions and usage, the projects
in Hopper's home folder, a queue of what's running, and what needs me. It dispatches and attaches;
Claude Code does the work. Ink (React for the terminal) on Node, run from `dist/` so it opens fast.

The plan is `../proj_sb-meta/planning/hopper/plan-v2.md`. Read it before changing behaviour.

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
- **A conversation is a Claude Code background session.** `t` starts one with `claude --bg`
  in the project's folder, with `hopperPrompt` appended so Claude knows the project's `_open.md`,
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
  treats them as keys. Turn reporting off around anything that takes over the terminal.
- **Claude does its own mouse selection** (it asks for "any" mouse tracking) and copies with OSC 52. The headless terminal has no clipboard, so `embed.ts` catches OSC 52 and Hopper copies.
  Hopper's own drag-select is only the fallback for programs that don't want the mouse.
- **Usage comes from `claude -p /usage`**, which is answered locally at no cost and refreshes the
  cache. Never read login tokens for it.
- **Routines** (`src/routines.ts`): files in `<home>/routines/`, runs in `<home>/state/runs.jsonl`,
  results in `<home>/routines/<name>/runs/`. launchd runs `hopper run <name>`; `syncLaunchd`
  keeps `~/Library/LaunchAgents/com.saltbark.hopper.*` in step (tests set `HOPPER_LAUNCHD_DIR`
  and `HOPPER_NO_LAUNCHCTL`). A run gets `--add-dir` on its routine folder so it can write its
  result without asking. The model and routine of a conversation Hopper started are in
  `<home>/state/conversations.json`; Claude Code doesn't report them.
- **Keys are letters and esc.** `esc` is Hopper's even inside an embedded conversation; Claude's
  interrupt is ctrl+c (passed through) or `i` from the list. No Ctrl or Cmd bindings. `esc` goes up a level; the top level is
  a menu of single letters.

## Its own rules

This project owns its architecture, stack, deployment, and naming. It is symlinked into the
`sb-meta` orchestration repo for convenience, which implies nothing about sharing anything with
the projects sitting next to it. Do not carry a pattern into this repo from another one merely
because it was nearby.

The one exception: if this project is TypeScript, the shared toolchain conventions in
`../proj_sb-meta/conventions/toolchain/` apply. Copy those lint, format, and test configs rather
than forking them; `just adopt-toolchain hopper` does it. Nothing else in that repo governs this
one.

Plans live in `../proj_sb-meta/planning/hopper/`.
