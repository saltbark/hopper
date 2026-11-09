# hopper

A terminal app, open all day in its own window, for work handed to Claude Code agents across
several projects and several Claude logins. It shows each login's sessions and usage, the projects
in Hopper's home folder, a queue of what's running, and what needs you. It dispatches and attaches;
Claude Code does the work. Ink (React for the terminal) on Node, run from `dist/` so it opens fast.

Plans live outside this repo. If there's a `CLAUDE.local.md` beside this file, read it first: it says
where they are.

## Things that are easy to get wrong

- **Never set `CLAUDE_CONFIG_DIR` for the default login.** With it set to `~/.claude`, the
  existing login reads as logged out. The default login (`config_dir = "default"`) runs with the
  variable unset; every other login gets it set to its own directory. See `src/claude.ts`.
- **A local account is Claude Code pointed at Ollama** (`provider = "ollama"`, `src/local.ts`).
  Hopper writes the server, model and context window into the env block of that account's own
  `settings.json`, so anything run with its config dir uses them, `claude` by hand included.
  Its "signed in" is the server answering with the model, asked every poll, never
  `claude auth status`; it has no usage. Routing goes by model: only `model = "local"` runs on
  it, and nothing else ever does, so Opus work can't fall back to it. It gets `--model` with
  its own model, no `--effort`, no `--remote-control` (no login), and dontAsk when unattended.
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
  _needs you_, until it's archived (`e`; still `<home>/state/done.json` and `done` in code).
  One can be put on hold (`h`, `<home>/state/held.json`): still waiting, but counted nowhere
  (`waitsOnMe`). The hold
  keeps when it was set, and a reply in the transcript after that ends it (`gather`), so there
  is nothing to clear by hand when the conversation moves on. `claude --bg` refuses
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
  Finding that row reuses the lists' own windowing (`workItemAt`, `itemLines`, `projectLines`,
  `accountLines`), so a change to how a list lays out its lines carries over to the mouse.
- **Pastes come apart from keys.** `usePaste` (App.tsx) turns on bracketed paste, so a paste
  arrives whole in `onPaste` (`keys.ts`) and never reaches the key handlers. In a conversation it
  goes to Claude in one write, in the paste markers when Claude asked for them (`pasteBytes`):
  sent as keys, it arrived in pieces, as several pastes or with its line breaks pressing Enter.
  A new text field gets a line in `onPaste` too, or pasting into it does nothing.
- **Claude does its own mouse selection** (it asks for "any" mouse tracking) and copies with OSC 52. The headless terminal has no clipboard, so `embed.ts` catches OSC 52 and Hopper copies.
  Hopper's own drag-select is only the fallback for programs that don't want the mouse.
- **Panels without the keys are drawn darker** by `Frame`'s `dimmed`: its outer box is Ink's
  internal `ink-box` with `internal_transform` (`dimLine` in `theme.ts`), which Ink runs over every
  line of text inside, after the text's own colours. `<Box>` doesn't take a transform and
  `<Transform>` can't hold boxes, so this leans on Ink internals: check it after an Ink upgrade
  (`test/dim.test.tsx`).
- **Usage comes from `claude -p /usage`**, which is answered locally at no cost and refreshes the
  cache. Never read login tokens for it.
- **`z` keeps the Mac awake** (`src/awake.ts`, `useAwake` in `hooks.ts`): while it's on, a
  `caffeinate -i -w <hopper's pid>` child, so it quits with Hopper however Hopper ends. On or off
  is kept in `<home>/state/awake.json`, so a restart while I'm away doesn't drop it. App's
  `keepAwake` prop is what holds the Mac awake; tests pass a fake, and it's null off macOS.
- **Routines** (`src/routines/`): files in `<home>/routines/`, runs in `<home>/state/runs.jsonl`,
  results in `<home>/routines/<name>/runs/`. **Nothing runs with Hopper closed**: the open app
  runs a routine when its time has passed since its last run, catching up only within an hour
  (`src/autopilot.ts`, `useAutopilot` in `hooks.ts`, after every poll). There is no launchd;
  `removeLaunchd` takes out entries earlier versions made, when the app starts. Tests run with
  `HOPPER_NO_AUTOPILOT` set (vitest.config.ts); App's `autopilot` prop turns it back on. A run
  gets `--add-dir` on the routines folder so it can write its result, and what routines share,
  without asking. The model and routine of a conversation Hopper started are in
  `<home>/state/conversations.json`; Claude Code doesn't report them. A routine's reports are
  the files in its `runs/` folder (`listReports`), not the run log, so a report written some
  other way shows too; the log only adds which conversation wrote it.
- **Every conversation Hopper starts gets `--model` and `--effort`.** Left off, the login's own
  settings (or its plan) would decide, and Hopper couldn't say which. What a draft or routine
  doesn't pick comes from `defaultsFor` (`src/config.ts`): its project's, then `config.toml`'s,
  then `CHOICE_DEFAULTS`. Wherever a default applies it is shown by name (`choiceText`:
  "opus[1m] (default)"), never as a bare "default". A conversation's `ranOn` is the full model id
  its newest reply came from, read from its transcript (`src/transcript.ts`).
- **Every conversation also says whether it works in a worktree** (`--settings` with Claude's
  `worktree.bgIsolation`). Left off, Claude makes a background session enter a worktree before it
  may edit anything. A draft's `worktree` (yes or no, `W`) falls back through `defaultsFor` like
  model and effort, default yes; queued work and routines always get one, since they run side by
  side in one checkout.
- **Unattended means a mode that never asks, and a result file.** Routine runs and anything
  `hopper dispatch` starts get `unattendedPermissions` (`src/claude.ts`): `--permission-mode
auto`, except for Haiku, which has no auto mode (Claude falls back to asking, and the run
  stalls), so it gets `dontAsk` and a narrow `--allowedTools` list. Absolute paths in a rule
  start with `//` (`Edit(//Users/…/**)`); `Write(...)` rules don't cover the Write tool. Their
  prompt (`unattendedPrompt` in `src/prompts.ts`, `routineInstructions` for routines) says never
  to wait, to work on a branch, and where to write the result. `startDraft` (`src/start.ts`) is
  the one way a draft starts, from the app or the dispatcher; don't start one another way.
- **A routine's finished runs are `filed`**, not listed or in Done (`gather` in `model.ts`):
  they live in the routine's reports. Only a run `blocked` on a question stays in waiting.
  Reports are read or unread (`src/seen.ts`, `state/read.json`), and nothing else: routine
  runs write no `needs:` line (queued drafts still do; chains depend on it). The routine's row
  carries a dot while any report is unread; it doesn't chime or count in the title. Reports
  older than `read.json` count as read, so a new file lights nothing. ⏎ on a routine hands the
  keyboard to the list in its details (`reports` in App, `sel` -1 is "edit the prompt").
- **Reports are laid out, not printed.** `src/tui/markdown.ts` reads a report with `marked`'s
  lexer and turns it into lines of styled spans already wrapped to the panel, one per line on
  screen, since the scroll keys count them (`reportLines`, `reportMaxScroll`). Links show their
  text and carry the URL as an OSC 8 hyperlink; Ink measures those correctly.
- **Up next is drafts with `queue:`.** `src/dispatch.ts` decides what is ready (`after:` names
  drafts; a dependency is finished when its conversation is in Done) and on which account
  (route order, `max_running`, the reserve, and at night the budget measured from
  `state/night.json`). One dispatch at a time (`state/dispatch.lock`). The open app dispatches
  when `dispatchSignal` changes (a draft queued, a conversation moving, night falling), and every
  five minutes while work is queued, for room freeing up on an account.
- **`docs/agents.md` is the agents' guide**, copied to `<home>/CLAUDE.md` whenever it differs
  (`src/guide.ts`). A change to a command agents use (`src/commands.ts`) changes it too.
  Routine templates are `templates/routines/*.md`.
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
  included; the way back to Hopper is Claude's own ← at the empty prompt, or ctrl+] (one of two
  Ctrl bindings), and both leave it live. Claude's interrupt is ctrl+c (passed through) or `i` from
  the list. The other is ctrl+g while writing a draft or routine prompt (and on a draft's row or
  the prompt's line, as `o`): it goes on in `$EDITOR`, Claude Code's own key for that, on purpose.
  In a conversation ctrl+g is Claude's, passed through. No other Ctrl or Cmd bindings. What the
  keys do is described once, in `src/tui/keymap.ts` (the key bar and `?` both read it); a key
  added or changed in `keys.ts` gets its line there too. `esc` goes up a level; the top level is
  a menu of single letters.
- **Only a release copy checks for updates** (`src/update.ts`, `useUpdate` in `hooks.ts`). A copy
  built from git (no `RELEASE` file) never asks and shows nothing, so a working checkout isn't
  nagged. A release copy reads `hopper.saltbark.com/latest.json` (written by `site/build.ts` from
  the tag and its `CHANGELOG.md` entry) at most every six hours, cached in
  `<home>/state/update.json`; `V V` or `hopper update` runs `install.sh` for that version. A
  running app can't swap itself: once `~/.hopper/app/current` is newer than what's running, the
  bottom right says to reopen it. App's `updater` prop is what checks; tests pass a fake.
- **Releasing** (only when asked; unattended runs never release or deploy). From the main
  checkout on `main` with a clean tree (`scripts/release.ts` refuses otherwise):
  `pnpm release minor` (or `patch`, `major`, a version) bumps `package.json`, writes a
  `CHANGELOG.md` entry, commits `Release vX.Y.Z` and tags it, pushing nothing. With no terminal
  no editor opens, so the entry is every commit subject since the last tag, `Site:` ones
  included: rewrite it as a few plain lines about what changed in the app, amend the commit and
  retag (`git tag -fa`), all before pushing. Then `git push origin main vX.Y.Z`. The tag runs
  `.github/workflows/release.yml`: `pnpm check`, `scripts/pack.sh`, the GitHub Release, then
  `pnpm site:deploy`, so the site's header names the new version (it's written in at build
  time). Check the run (`gh run watch`) and the live page.
- **The site** (`site/`) deploys from CI. For a site-only change, run the release workflow by
  hand with `site` ticked (`gh workflow run release -f site=true`); that packs but publishes no
  release. Deploying from a laptop needs the deploy token in a gitignored `.env`, which only the
  main checkout has: from a worktree, wrangler falls back to its own login and can deploy to
  the wrong Cloudflare account. When the app's look changes, `pnpm site:capture` recaptures
  the frames (`site/frames.json`, committed) from the made-up world in `src/demo.ts`. Plain pages
  beside it are `site/pages/` (the iPhone app's `/iphone` and `/privacy`, which App Store Connect
  links to; their words were approved by Travis, so change them only when asked); a new page
  waits in `site/drafts/`, which isn't published.

- **The iPhone app talks to the open app through a relay that can't read it** (`src/remote/`,
  `relay/`, `ios/`). `hopper pair` shows a QR code; the phone proves it saw it, you say yes, and
  the phone's key goes in `~/.hopper/remote/phones.json` beside the Mac's own key (both 0600, never
  in Hopper's home folder, which may sync). `useRemote` (`hooks.ts`) runs a `Bridge` while the app
  is open and sends each phone `phoneView(snap)` when it changes; tests turn it off
  (`HOPPER_NO_REMOTE`). The crypto has a Swift twin (`ios/Hopper/Remote/Crypto.swift`, `Wire.swift`):
  a change to keys, framing or messages changes both, and `test/fixtures/remote-vectors.json` is
  checked by `test/remote.test.ts` and by `ios/scripts/check-vectors.swift` (how to run it is at
  its top; it reads the pairing link and a version answer through `Wire.swift` too). The protocol
  version (`PROTOCOL`, `OLDEST` in `wire.ts`; `protocolVersion` in `Wire.swift`) is in the link and
  the hellos; a Mac that doesn't speak a phone's version answers its hello with no `eph`, and each
  side says which one to update (the phone in its chip and on Accounts, the Mac in `hopper
  phones`, through `~/.hopper/remote/status.json`). The App Store app and Hopper update apart, so
  keep `OLDEST` low when a change leaves older phones working. The phone's snapshot types (`Snapshot.swift`) follow `src/remote/view.ts`, and its
  screen frames (`Screen.swift`) follow `src/remote/screen.ts`.
- **A conversation on the phone is a second attach on the Mac.** `PhoneScreen` (`screen.ts`) runs
  its own `EmbeddedSession` at the phone's width and `TALL` (400) rows, and sends the changed rows
  of `screen()` as runs. Claude draws its whole conversation into a screen that tall (from the
  top, prompt pinned to the bottom, blank rows between, which the phone folds), so the phone
  scrolls it natively; only older history goes to Claude as wheel ticks. `submit` pastes the text
  and presses Enter `SUBMIT_GAP_MS` later: sent together, Claude takes the Enter as part of the
  paste.
- **A conversation draws at one size, the last attach client's**, rows included, and nothing can
  give two clients two layouts. Hopper's panel and the phone's attach are both `EmbeddedSession`s
  in this process, so `sizeOwner` (`embed.ts`) knows which one set it: `send` (keys, pastes,
  clicks, the wheel; not the pointer passing over) calls `claim`, which takes the size back
  first, and `enter` (`actions.ts`) reclaims too. The phone is told whether it has the size
  (`mine` in each frame) and offers to take it back.
- **What the phone does goes through the Mac's own code.** `src/remote/actions.ts` (`act`) answers
  `new`, `start` (now, or queued for when there's room or tonight), `hold`, `done` and `routine`
  (resume, pause, run) with `startDraft`, `saveDraft` and dispatch, `setHeld`, `setDone`,
  `saveRoutine` and `runRoutine`, as the keys in `src/tui/actions.ts` do; a change to what a key
  does on the Mac changes it here too. Each answer echoes the action's `ref`. Nothing the phone
  sends becomes a path or an argument unchecked: items, routines and reports are looked up in
  the snapshot by id, and a model, effort, worktree or account must be one Hopper offers
  (`choice`). What goes back is kept under the relay's 1 MB (`REPORT_MAX`; `Link.send` drops
  anything bigger rather than have the relay close the Mac's socket).
- **The relay** (`relay/`, a Worker with one Durable Object per pairing) forwards binary frames
  between a room's `mac` and `phone` sockets and says only `{"peer":"up"|"down"}` itself. Each
  pairing has a room token (in the QR link, `t`; `phones.json` and the phone's Keychain); both
  sides show it on connecting (`roomUrl`), the room keeps a hash of the first one it sees and
  closes any other with 4001, and the Worker turns away a request with no token before it reaches
  a room. It also closes a socket over `MAX_BYTES` (4009) or `PER_MINUTE` messages (4029)
  (`relay/src/limits.ts`; the entry module may export only handlers and classes, and the runtime
  makes a Durable Object with `(state, env)`). A side refused with 4001 stops trying: every retry
  would be refused and billed. `test/relay.test.ts` runs the room against fakes. It lives
  at `hopper-relay.saltbark.com` (Cloudflare's free certificates don't cover a sub-subdomain).
  `pnpm relay:dev` runs it on :8787 (`hopper pair --relay ws://<this mac>:8787`, or
  `HOPPER_RELAY`); `pnpm relay:deploy` ships it, only when asked, from the main checkout (its `.env`
  holds the token, as for the site).
- **Every message into the relay is billed**: each 20 incoming WebSocket messages count as one
  Durable Object request (1M a month on the $5 plan; the aim is under 1% of it), each connection
  is one, and what the relay sends out, and protocol pings, are free. So: the Mac sends nothing
  while no phone is there (`Link.send`) or to a phone not heard from in `LEASE_MS` (the phone says
  `keep` after 30 s quiet); a snapshot whose only change is ages waits `AGES_EVERY_MS`; the screen
  is paced by how lately the phone did something (`PACE` in `screen.ts`: 10 a second just after a
  key, 2 for a minute, then 1); and both ends keep their socket open with protocol pings (the Mac
  through `ws`; Cloudflare drops one silent for about three minutes, and a reconnect costs a
  request). A new kind of message should say what it costs. The relay itself keeps nothing and
  runs no timers, so its Durable Object hibernates between messages.
- **The iOS app** is SwiftUI for iOS 27 with no packages; the project uses synchronized folders, so
  a file added under `ios/Hopper/` is in the target. Everything is on the main actor by default;
  the socket, crypto and decoding are `nonisolated` (`Connection.swift`, `Wire.swift`,
  `Crypto.swift`, the `Decodable` types) so frames are opened and laid out off the main thread
  (`ScreenBuffer`), and only what's ready to draw reaches it. `AppModel` works the lists out once
  per snapshot (`sections`, `items`, `archived`), not in views, and shows a swipe's move before
  the Mac answers (`move`), putting it back if the Mac says no. It keeps the last snapshot on the
  phone, so the app opens on it while it connects. Build it with `DEVELOPER_DIR` set to Xcode
  (`xcodebuild -project ios/Hopper.xcodeproj -scheme Hopper -destination 'generic/platform=iOS
Simulator' CODE_SIGNING_ALLOWED=NO build`).
- **The app has a demo built in** ("Try it without a Mac" on the pairing screen), for anyone
  without Hopper, App Review first: Apple turns down apps that need software from outside the
  App Store to be tried (4.2.3(i), 2.1). `DemoMac` (`ios/Hopper/Demo/`) stands where
  `Connection` does (both are `MacLink`s) and plays `demo.json`, which
  `ios/scripts/demo-bundle.ts` writes from the made-up world through the Mac's own code
  (`phoneView`, `act`); it answers actions by moving items in its snapshot, shifts every time in
  it to now, and draws a made-up Claude. When what the Mac sends changes (a field in `view.ts`,
  an answer in `actions.ts`), run `npx tsx ios/scripts/demo-bundle.ts` again, and teach `DemoMac`
  any new action. Nothing of the demo is kept, and it doesn't lock. `HOPPER_DEMO=1` opens on it
  (debug).
- **To see a screen without a phone**, run `npx tsx ios/scripts/demo-mac.ts <link file>` (Hopper's
  made-up world from `src/demo.ts`, a real bridge on the relay, pairing that says yes by itself),
  then `ios/scripts/sim.sh <simulator> <link file> <screen> <out.png> [--fresh]`, which launches a
  Debug build paired from the link and opened on that screen (`HOPPER_PAIR_LINK`, `HOPPER_SHOW`,
  both `#if DEBUG`). Build it signed for the simulator (no `CODE_SIGNING_ALLOWED=NO`): an unsigned
  simulator app can't write the Keychain, so the pairing doesn't stick. An iPhone 13 mini
  simulator shows the smallest screen the app is used on. The demo's conversations open on a
  made-up Claude (`ios/scripts/demo-screen.ts`), so `conversation` shows the pane too. `tour`
  walks the app through pairing, a conversation answered, a draft started, projects, accounts and
  the lock by itself, marking each step on stderr: it's what the App Review video was recorded
  from (`HOPPER_PHONE_NAME` names the phone; `HOPPER_DEMO_CONFIRM_MS` makes the demo Mac wait
  before its yes, so the pairing screen shows).
- **TestFlight**: `ios/scripts/testflight.sh` archives a Release build, its build number the UTC
  time (`YYYYMMDDHHMM`, so each is higher than the last), and uploads it to App Store Connect;
  `--dry` exports a local `.ipa` instead. It signs and uploads with the Apple ID signed in to
  Xcode, or an App Store Connect API key when `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_PATH` are
  set. Upload only when asked, like a release. The version is `MARKETING_VERSION` in the project.
  `ITSAppUsesNonExemptEncryption` is NO: the app's encryption is CryptoKit's, Apple's own, which
  is exempt; that changes if it ever ships its own crypto. The app icon is drawn from the frog's
  pixel runs (`Frog` in `Parts.swift`), 40 points a pixel on Hopper's dark ground.

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
- `src/commands.ts`: `hopper list`, `draft new`, `routine check|templates|install`, `dispatch`;
  `src/cli.tsx` only wires and prints them. `src/dispatch.ts`, `src/start.ts`, `src/guide.ts`.
- `src/fsutil.ts` (`readIfThere`, `writeAtomic`) and `src/frontmatter.ts`: use these for any
  state file rather than writing fs code again. A read-change-write of a state file goes through
  `inTurn` (one at a time) and `readForChange` (a file that doesn't parse is set aside, never
  written over); a load for showing may still fall back to empty. Tests share
  `test/helpers.ts` (`fakeClaude`).

## Its own rules

This project owns its architecture, stack, deployment, and naming. Lint and format are oxlint and
oxfmt; `pnpm check` runs typecheck, lint, tests and build. Tests need `FORCE_COLOR=0` when the
shell forces colour. Examples and fixtures use made-up names (`bh/atlas`, `pm/tern`, Blue Heron,
Pinemoor); keep real accounts, clients and projects out of the repo.
