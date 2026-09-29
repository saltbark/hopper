---
project: meta/inbox
schedule: weekly sun 3:00
model: haiku
effort: low
enabled: true
---

Look for documentation that has drifted from the code, in the projects that were active this
week (a conversation in the last seven days in `hopper list --json`).

For each: check its `CLAUDE.md` against the repo. Paths and files it names that no longer exist,
commands it gives that aren't in `package.json` or the `justfile`, functions it names that
`grep` can't find. And check its `_open.md` for items the last week of `git log` suggests are
already done.

Report only; change nothing. In the result, one line per finding with the file and line.
