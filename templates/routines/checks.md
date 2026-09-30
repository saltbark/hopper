---
project: meta/inbox
schedule: daily 5:00
model: sonnet
effort: low
enabled: true
check: just check
---

The nightly check failed; its output is below. Find out why.

If the fix is mechanical and certain (a formatting slip, a stale generated file, a moved link),
make it in a worktree on a branch, commit, and say so in the result. Otherwise explain what's
wrong, which change caused it (`git log`), and what the person should do.
