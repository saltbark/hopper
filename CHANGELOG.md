# Changelog

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
