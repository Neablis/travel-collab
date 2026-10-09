# ADR-067: A multi-change assistant turn is stored as suggestions

**Status:** **Accepted — 2026-10-09.** Mitchell answered M40's decisions 6 and 7 as recommended.
**Deciders:** Mitchell (product); Claude — drafted
Related: **ADR-022** (the assistant is read-only and its proposals are ephemeral; this supersedes
that for planning turns of more than one change), **ADR-064** (a suggestion is not planning state
until it is accepted), **ADR-013** (one batch is one history entry), **ADR-005** (undo and revert
are compensating events), milestone `docs/milestones/M40-a-big-change-is-one-change.md`.

## Context

Under ADR-022 the assistant's write tools only collect commands. The proposal rides on the chat
message as data, the user reviews it on a card and clicks *Make the change*, and nothing is stored.
That works for one change. It does not work for the change Mitchell asked for on 2026-10-03:
*"if I ask it to add a day, have it add a day and fill it with proposed changes, then we can accept
or deny them after seeing them in the trip"*. A ten-change card is reviewed as text, in a chat
column, by one person, and is gone on reload.

ADR-064 already built the store for exactly that: suggestions are CRUD rows beside the trip, drawn
on the board as ghosts (W46), reviewed change by change, and replayed through the command pipeline
when accepted. Only a `suggester` may create one, though, and the assistant acts for its user,
who is usually an editor. Invariant 7 says the assistant takes only paths its user could take.

## Decision

1. **Editors may create suggestions too.** This relaxes spec W25 (suggesting was the suggester
   role's alone). An editor's suggestion is reviewed exactly like a suggester's. The owner is an
   editor here. Viewers still cannot suggest.
2. **An assistant suggestion is authored by the editor who asked**, with `via: "assistant"` on the
   suggestion row. History and the chip read *"Suggested by Ana, via the assistant"*. The author
   can withdraw it like any of their own.
3. **It does not count against the 50-per-author pending cap.** The 200-per-trip cap still holds,
   and one suggestion still holds at most 50 changes; a turn that would exceed either is refused
   with the reason, and nothing is stored.
4. **A planning turn whose proposal has more than one command is stored as one suggestion** in the
   same request that produced it, instead of being returned as an ephemeral proposal. Its changes
   carry the dependencies the suggestion module already computes. The stream's final chunk names
   the stored suggestion (id and change count), and the chat says where to look rather than
   rendering a card.
5. **A one-command answer keeps ADR-022's card**, and so does any turn carrying `inserts` (a
   playbook day). Neither has a reviewing problem, and a library insert is not a command a
   suggestion can store.
6. **The assistant saves a snapshot before it stores a multi-change suggestion**, named for the
   request (*"Before: add a day in Kyoto"*), through the same server action an editor's *Save
   snapshot* uses. A trip already at its snapshot cap stores the suggestion without one and says
   so.

## Consequences

- The ghost overlay, the suggestions chip, *Accept all* (one batch, M40 Part 1) and History are
  the review surface for a big assistant change. No second reviewing UI is built.
- A suggestion survives a reload and is seen by every editor, so a second editor can accept what
  the first asked the assistant for. That is the point, and it is also new: until now only the
  person who asked ever saw a proposal.
- `ask/apply` and `commitProposal` stay for one-change and insert turns. Two paths exist on
  purpose; the boundary is decision 4's command count.
- The eval suite (M33) grades the new outcome: a multi-change case now passes on a stored
  suggestion, not on a returned proposal.

## Alternatives considered

- **Store the proposal as its own table.** A second pending-change store beside ADR-064's would
  need its own overlay, review and cap. Rejected.
- **Record the assistant as the author.** It is not a member and cannot be reviewed against, and
  invariant 7 is easier to keep when the author is the person it acted for. Rejected.
