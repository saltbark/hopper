# Changelog

## 0.4.9 (2026-10-08)

- A little more room between a routine's next run and its project in the list.

## 0.4.8 (2026-10-08)

- Routines line up with conversations in the list. A routine's next run now sits between its
  name and its project, so every row ends at the panel's edge.
- Routines show the model they run with, their own or the default.

## 0.4.7 (2026-10-08)

- The model column in the lists is wide enough for opus[1m], which it used to cut to
  "opus[…" at every window size.

## 0.4.6 (2026-10-08)

- In a draft, a click puts the cursor where you click and a drag selects. A drag there no
  longer copies text from the conversation hidden behind the draft.
- Projects lists only projects. Turn on "show folders" in settings to list the folders above
  them too, drawn dimmer and in italics; ⏎ on one narrows the list to every project in it.
- A setting's name too long for its column no longer runs into its value.

## 0.4.5 (2026-10-07)

- Conversations Hopper starts from Up next no longer have ☾ in front of their names; they're
  named like any other conversation, in Hopper, `claude agents` and claude.ai.

## 0.4.4 (2026-10-05)

- Done is now Archived, and `e` archives a conversation, as in Gmail; in Archived (`v`), `e`
  brings it back. `d` no longer does anything in the list.
- `e` also throws away a draft or removes a routine, and you confirm by pressing `e` again
  rather than `y`. Removing an account or a setting is `d`, then `d` again. A draft's or
  routine's effort moved to `E`.
- Archiving moves the row at once, instead of after a full reload of every account's sessions.

## 0.4.3 (2026-10-04)

- Running is the first group in Conversations, then waiting on you, on hold, drafts, proposed,
  routines and up next, so the two you go back and forth between sit together at the top.
- `n` still jumps to the first conversation waiting on you, below the running ones.

## 0.4.2 (2026-10-02)

- Lists sort by when a conversation last changed hands, not when it started: a running one by
  when you last wrote to it, and one that's waiting, on hold or done by when Claude stopped. An
  old conversation you reply to moves to the top, and Running doesn't reshuffle with every tool
  call. A conversation with no transcript still sorts by its start.
- A row's age, and a project's last activity, count from the same moment. The details line adds
  "last written to" or "stopped" beside "started", and `hopper list --json` gives each
  conversation an `activeAt`.

## 0.4.1 (2026-10-01)

- Typing a draft no longer leaves a blank line after a line that reaches the right edge of the
  panel. It happened when a word ended exactly at the edge, or when the cursor sat at the end of a
  full line.

## 0.4.0 (2026-10-01)

- Dimming is a setting: Settings has a `dim` row under General for how much darker the panels
  without the keys are drawn. ⏎ steps through 38 (the default), 50, 65, 80, 0 (off) and 20; it's
  kept as `dim` in `config.toml`, any whole number from 0 to 80. 0 turns dimming off entirely.

## 0.3.0 (2026-10-01)

- Keep awake: `z` keeps the Mac awake while Hopper is open, so the night's work runs and a
  conversation can be reached from your phone. It's off until you turn it on, then on until `z`
  again, and Hopper remembers it across restarts. `awake`, in green at the right end of the key
  bar, says it's on. It uses `caffeinate`, so the display still sleeps; a closed lid still
  sleeps a laptop. macOS only.
- The key bar no longer names the focused panel at its right end; it ends in `? all keys`.

## 0.2.0 (2026-09-30)

- On hold: `h` on a conversation waiting on you moves it to its own group, marked ◷, for one you
  know about but can't act on yet. It stops counting in the title, the project and account
  numbers, the chime and `n`. `h` again takes it off, and so does any new reply from Claude.

## 0.1.0 (2026-09-30)

- The first release.
