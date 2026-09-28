# Hopper

Toss work in the hopper, hop from item to item. A terminal app for handing work to Claude Code
agents across projects and Claude logins.

```sh
pnpm install && pnpm build
pnpm link --global        # puts `hopper` on your PATH
hopper init               # config, home folder, and your current Claude login as the first account
hopper status             # what Hopper sees, as text
hopper                    # the app
```

Everyday: Hopper opens on Projects, in a band across the top beside Accounts. Projects with
something waiting, running or used today are listed first by full key, above the tree. `f` and a
few letters finds a project; ⏎ focuses it, `tab` starts a conversation there. Under the band is
one list of every conversation that isn't done, grouped: waiting on you, drafts, running, up next
(`w` `d` `r` `u` jump to each). Done sits below it.

`tab` starts a new conversation as a draft: a real text box (arrows, option+arrows by word,
shift to select, ⏎ for new lines), saved as you type. `esc`, then `s` starts it, `p` moves it,
`y` copies it, `x` throws it away, or `esc` keeps it.

Conversations open in the right-hand panel: the real Claude session, every key going to Claude,
`esc` included. ← at Claude's empty prompt, or ctrl+] from anywhere, comes back to Hopper and
leaves it open (⏎ goes back in). Inside, ctrl+c interrupts Claude; from the list, `i` sends it
an esc. `m` marks a conversation done. Ask Claude
to file items; it knows the project's `_open.md`. The first conversation in a new folder asks you
to trust it once (`T`).

Mouse: the wheel scrolls whatever is under the pointer (a list, or the conversation), and a click
focuses a panel. In the list and in Done, the row under the pointer lights up; a click selects it,
and a second click opens it. A click on a conversation gives it the keyboard, and a click on the
details of one that isn't open opens it. Drag inside a conversation to select; letting go copies it.
Elsewhere, hold your terminal's selection modifier (often Option or Shift) to select by dragging.
← and → move between the columns.

Models: in a draft, after `esc`, `m` picks the model and `e` the effort. Projects can set defaults
in `projects.toml` (`model = "haiku"`, `effort = "low"`). The list shows what each conversation
started with.

Projects from a meta repo: a `[[source]]` in `projects.toml` lists every project that repo's
`paths.local` has on this machine, under a prefix, read fresh each time. Its open items are the
meta repo's `planning/<key>/_open.md`, and conversations are told to follow that repo's planning
rules. The meta repo itself is `<prefix>/meta`. A `[[project]]` with an imported key adds to it.
Conversations run from the meta repo, so its `CLAUDE.md` and conventions apply, and reach the
code through its `projects/` symlink; `run_in = "project"` on the source runs them in each
project's own folder instead. Projects in the home folder (`meta/`) run from the home folder; any
`[[project]]` can set `run_in`.

    [[source]]
    prefix = "kf"
    repo = "~/Dropbox/Workspace/proj_kf/proj_kf-meta"
    strip = "kf"    # registry key kf/console lists as kf/console, not kf/kf/console
    # run_in = "project"   # run in each project's folder, not the meta repo

Drafts: `tab` opens one; `esc` saves it and leaves it selected in the list, its text on the
right. From its row: `s` starts it, `m` `e` choose the model and effort, `p` moves it to another
project, `y` copies it, `d` throws it away; ⏎ is the only way back to writing it.

Routines: a prompt that runs on a schedule, each run its own conversation. Write it as a draft,
then `esc`, `r`: name it and say when it runs (`daily 7:00`, `weekdays 7:00, 13:00`,
`weekly mon 9:00`, `monthly 1st 9:00`, or blank for run-now only). Routines have their own group
in the list; from a routine's row `s` runs it now, `S` changes the schedule, `P` pauses, `d`
removes it, and ⏎ edits the prompt.
Each run writes a result file under `<home>/routines/<name>/runs/`; a run that says nothing needs
you goes straight to Done. macOS runs the schedule (`hopper run <name>` from launchd), so
routines run with Hopper closed. A run is skipped when every account for its project is full.

    hopper routines          list them and when they next run
    hopper routines sync     make the launchd schedule match the routine files
    hopper run <name>        one run, now

Accounts: the default account (`*` in the Accounts panel) runs anything no prefix names.

Keys: `p` `c` `v` `a` jump to projects, conversations, done, accounts; `n` the first thing waiting on
you; `J` `K` (or shift+↑↓) the nearest folder in Projects, the next group in the list; `d` on a
conversation marks it done (in Done, brings it back);
option+↑↓ in Projects go up a level (↑ the parent, ↓ the parent's next sibling); on the list →
opens a conversation like ⏎ and ← comes back, so the arrows alone get around; `x` twice
quits. The bottom line shows the keys for what is selected that nothing on screen already
shows; `?` shows them all, starting there.

Settings: `,` shows every setting in `config.toml`, `accounts.toml` and `projects.toml` in one
place, what each is now, whether it's set or a default, and what it does. `⏎` edits one (or
moves a choice on), `d` puts it back to its default or removes an entry, `a` adds an account,
source or project, `o` opens the file itself in `$EDITOR`. The files stay the truth; writes from
the screen keep a file's header comment but not comments further down. It also says when no
account runs a prefix, so conversations there wouldn't start.

Accounts: in the app, `a` then `a` again adds a Claude account (a short name, its config directory,
then Claude's own sign-in). `e` sets the prefixes it runs (`kf/, meta/`, or `*` for everything).
When several accounts run a prefix, work goes to the first one that is signed in and has room;
`1` makes an account first choice.
