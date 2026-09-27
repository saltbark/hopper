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

Everyday: Hopper opens on Projects. `f` and a few letters finds a project; ⏎ focuses it. The
middle column is one list of every conversation that isn't done, grouped: waiting on you, drafts,
running, up next (`w` `d` `r` `u` jump to each). Done sits below it.

`t` starts a new conversation as a draft: a real text box (arrows, option+arrows by word,
shift to select, ⏎ for new lines), saved as you type. `esc`, then `s` starts it, `p` moves it,
`y` copies it, `x` throws it away, or `esc` keeps it.

Conversations open in the right-hand panel: the real Claude session, every key going to Claude
except `esc`, which comes back to Hopper and leaves it open (⏎ goes back in). Inside, ctrl+c
interrupts Claude; from the list, `i` sends it an esc. `m` marks a conversation done. Ask Claude
to file items; it knows the project's `_open.md`. The first conversation in a new folder asks you
to trust it once (`T`).

Mouse: the wheel scrolls whatever is under the pointer (a list, or the conversation), and a click
focuses a panel. Drag inside a conversation to select; letting go copies it to the clipboard.
Elsewhere, hold your terminal's selection modifier (often Option or Shift) to select by dragging.
← and → move between the columns.

Models: in a draft, after `esc`, `m` picks the model and `e` the effort. Projects can set defaults
in `projects.toml` (`model = "haiku"`, `effort = "low"`). The list shows what each conversation
started with.

Routines: a prompt that runs on a schedule, each run its own conversation. Write it as a draft,
then `esc`, `r`: name it and say when it runs (`daily 7:00`, `weekdays 7:00, 13:00`,
`weekly mon 9:00`, `monthly 1st 9:00`, or blank for run-now only). Routines have their own group
in the list; ⏎ opens one, and after `esc`: `s` runs it now, `S` changes the schedule, `P` pauses.
Each run writes a result file under `<home>/routines/<name>/runs/`; a run that says nothing needs
you goes straight to Done. macOS runs the schedule (`hopper run <name>` from launchd), so
routines run with Hopper closed. A run is skipped when every account for its project is full.

    hopper routines          list them and when they next run
    hopper routines sync     make the launchd schedule match the routine files
    hopper run <name>        one run, now

Accounts: the default account (`*` in the Accounts panel) runs anything no prefix names.

Keys: `p` `q` `v` `c` jump to projects, the list, done, accounts; `n` the first thing waiting on
you; `?` help; `x` quit.

Accounts: in the app, `c` then `a` adds a Claude account (a short name, its config directory,
then Claude's own sign-in). `e` sets the prefixes it runs (`kf/, meta/`, or `*` for everything).
When several accounts run a prefix, work goes to the first one that is signed in and has room;
`1` makes an account first choice.
