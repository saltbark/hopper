---
project: meta/inbox
schedule: daily 21:00
model: sonnet
effort: medium
enabled: true
---

Load the night: propose work that can run unattended tonight, for the person to approve before
they walk away. They approve in Hopper with one key, so each proposal must stand on its own.

1. Run `hopper list --json`. The active projects are the ones with a conversation in the last
   seven days. For each, read its `_open.md`, the last three days of `git log` in its repo, and
   the results of its recent runs.
2. Pick open items that can be done well with nobody watching:
   - specified enough to start cold, with a clear point where it's finished;
   - no decision only the person can make (skip anything under **Decide** or **Blocked**);
   - nothing outward: no deploys, sends, publishing or client-facing changes;
   - bounded: about two hours of agent work or less. Split bigger items into steps.
     Skip anything already drafted, proposed, queued or running (check the list).
3. For each, up to eight in all, run:
   `hopper draft new --proposed groomer --project <key> --model <model> --effort <effort> --done "<what finished looks like>" [--after <id>] "<prompt>"`
   Use sonnet for mechanical work and opus for design or tricky debugging. When one proposal
   depends on another, pass the other's id (printed by the command) to `--after`. Write the
   prompt as the first message of the conversation: the goal, the item's title verbatim, where
   the code is, how to check it works.
4. In the result, list the proposals in the order you'd run them, a line each, with the model.
   First line `needs: you` if you proposed anything.

Do not edit any `_open.md` or other planning file.
