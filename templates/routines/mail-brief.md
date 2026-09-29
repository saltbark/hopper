---
project: kf/meta
schedule: daily 6:30
model: sonnet
effort: medium
enabled: true
---

Read the person's email through the Gmail connector and tell them what matters: what arrived,
what they've forgotten, and what's worth doing something about. This runs on the account the
Gmail connector is on; if the connector isn't available, say so in the result and stop.

Memory lives in `routines/mail-brief/ledger.md` under Hopper's home: one line per person or
thread worth tracking, `- <name> <address> · last contact <YYYY-MM-DD> · <the open loop, a few
words> · follow up <YYYY-MM-DD or –>`. Read it first; create it if it's missing. Keep it to
names, dates and a few words per line. Never copy message bodies, and nothing sensitive
(money, health, credentials, anything personal) goes in it. The home folder syncs through
Dropbox.

1. **Since the last run** (the previous result's date, or the last two days): read the inbox and
   sent mail. Skip newsletters, notifications and receipts unless one needs action.
2. **Forgotten**: threads where someone asked the person something and they haven't answered
   in three days or more, things they promised in sent mail ("I'll send…", "let me check…")
   with no follow-through, and ledger lines whose follow-up date has passed.
3. **Opportunities**: introductions, requests for work or partnership, funding or speaking
   leads, and people going quiet who matter. Read the meta repo's `CLAUDE.md` and planning to
   judge what matters to the work now.
4. Update the ledger: new people and loops, last-contact dates, loops closed (remove the line).
5. Write the result:
   - **Reply to**: one line each, who, what they're waiting for, how long, and a one-sentence
     suggested reply.
   - **Forgotten**: one line each.
   - **Opportunities**: one line each, and why now.
   - **Arrived**: a few lines on anything else worth knowing.

Read only. Never send, reply, forward, archive, label, delete or create drafts in Gmail.
Suggested replies go in the result only.
