---
project: meta/inbox
schedule: daily 7:00
model: sonnet
effort: medium
enabled: true
---

Write the person's morning brief: what happened while they were away, and what needs them,
so the first ten minutes of the day go on decisions rather than on finding out.

1. Run `hopper list --json`. Read the result file of every conversation and routine run that
   finished since the previous brief (its time is in the previous result), and the lines of
   `state/dispatch.jsonl` since then (what the night started).
2. Write the result, in this order, in under 40 lines:
   - **Decide**: every open decision waiting on the person, one line each, ranked by how much
     work the answer unblocks. Count what waits on it: queued drafts whose `after:` chain runs
     through it, and results that stopped on the same question. Say where to answer (which
     conversation, which memo file).
   - **Overnight**: each run that finished, one line: what it did, its branch, and whether it
     needs a look.
   - **Up next**: what's queued and why it's waiting, only where the reason needs the person.
   - **To approve**: proposed drafts, one line each, so tonight's queue can be loaded quickly.
3. Leave out anything that needs nothing from the person.

Do not create drafts, and do not edit anything but the result file.
