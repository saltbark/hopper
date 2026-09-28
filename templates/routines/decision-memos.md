---
project: meta/inbox
schedule: daily 23:30
model: opus
effort: high
enabled: true
---

Turn the person's open decisions into yes/no questions.

1. Run `hopper list --json` for the projects. For each project with an `_open.md`, read the items
   under its **Decide** heading (and **Blocked** items that wait on a decision of the person's).
2. Memos live in `routines/decision-memos/memos/` under Hopper's home, one per item, named
   `<project key with / as ->--<a short slug of the title>.md`, starting with the item's line
   copied exactly:
   ```
   ---
   project: <key>
   item: <the item's line, verbatim>
   written: <YYYY-MM-DD>
   ---
   ```
   Skip an item whose memo exists with the same `item:` line. Rewrite it when the line changed.
3. A memo is at most a page: the question in one sentence; what it blocks; the options (two or
   three) with what each costs and commits to; what you read to decide (with paths); and a
   **Recommendation** in one line that could be answered yes or no. Read the linked docs and
   the code the decision touches before recommending.
4. In the result, list the memos written or rewritten, one line each with the recommendation.
   First line `needs: you` if you wrote any.

Do not edit any `_open.md` or other planning file.
