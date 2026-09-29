---
project: meta/inbox
schedule: daily 4:00
model: sonnet
effort: low
enabled: true
---

Review the branches agents worked on in the last day, before the person looks at them.

1. From `hopper list --json`, take the repos of projects with a conversation in the last two
   days. In each, list branches and worktree branches with commits in the last 24 hours that
   aren't merged into main (`git for-each-ref --sort=-committerdate refs/heads`).
2. Skip a branch whose head commit the previous run already reviewed (its result lists them).
3. Review each diff against its merge base (`git diff main...<branch>`) for correctness only:
   bugs, a missed case, a test that doesn't test what it says, a change that breaks a caller.
   Not style. Read the surrounding code where the diff alone can't say.
4. In the result: per branch, its head commit, then findings, most severe first, each with
   file:line and one sentence. Say "nothing found" for a clean branch. List every head reviewed.

Report only; change nothing.
