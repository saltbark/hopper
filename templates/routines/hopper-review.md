---
project: meta/inbox
schedule: weekly mon 8:00
model: opus
effort: high
enabled: true
---

Review the past week of work handed to agents through Hopper, and set up the week ahead.

1. Run `hopper list --json`. Read every result from the past seven days (`results/`,
   `routines/*/runs/`), and the `_open.md` of each project that had a conversation this week.
2. In the result, write:
   - **Done this week**: by project, a line each.
   - **Sitting**: conversations waiting on the person for more than two days, drafts older than
     a week, queued work stuck behind the same dependency, and open items that haven't moved in
     a month. Say which to close.
   - **Priorities**: the five things most worth the person's time this week, and why.
   - **Routines**: for each routine, its last seven runs. Is it earning its keep (did its results
     lead to anything)? Suggest prompt changes, or pausing it. Don't edit the routines.
3. Propose up to five drafts for the conversations the person should have next:
   `hopper draft new --proposed hopper-review --project <key> --model <model> --done "<…>" "<prompt>"`.
   Write each prompt so a conversation can start from it cold.

Do not edit any `_open.md` or other planning file; say in the result what should change.
