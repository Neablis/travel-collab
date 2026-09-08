# ADR-042: The assistant proposes a playbook day by reference, and the server expands it

**Status:** **Accepted — 2026-09-08, and built the same day** (`657c372`): both
tools, the by-reference proposal, the server-side expansion with the ledger on
the batch's transaction hook, and a `simulatedModel` branch so the flow works
with `ai-live` off. Approved by Mitchell as one feature rather than a milestone:
*"Lets just start on this one feature, i can turn on ai-live to test."*
**Walked in a browser, and covered by an e2e spec** — `e2e/m10-simulated-ai.spec.ts`
("a playbook day the assistant found reaches the board once it is approved")
publishes a day into a minted city, asks for it in words that carry no change
verb, and asserts the card, the untouched board under it, and the day's stops
after Approve.

The hand walk of the deployed preview that closed the "not yet clicked" half
found what the spec is now phrased to catch: the simulated intent classifier
consulted `asksForAChange` alone while `askTurn` reached the library branch on
`asksForAPlaybookDay`, so *"find me a ready-made day"* was classified a
question, was offered no write tools, and could never produce a card —
`\bready-made\b`, `\bsaved day` and `\bsomeone else's day\b` only ever fired
when the user also happened to say a change verb. `ai-live` is off in every
Vercel environment, so that was the only path anyone could click. Fixed
2026-09-08; a spec worded "add a day from the playbook library" would have
passed throughout, which is why this one is not.
**Deciders:** Mitchell (product/eng — asked for it); Claude (architect) — drafted
Amends: **ADR-015 §2** ("two derived tool families, never hand-written") for a
third time, and **ADR-022 §1**, which amended it for *read* tools only
Related: **ADR-029** (a saved day is a value, copied in and out whole),
**ADR-013** (a batch is one history entry and one undo), **ADR-022** (read tools,
and the rule for earning one), **M11b** (the adds ledger and why it is credible)

## Context

Mitchell, 2026-09-08:

> Allowing the AI agent on a trip to search for Playbook for a existing day, and
> insert it into the trip. We will need to be careful how its prompted, and
> always ask the user if they want to add that day before doing it

Two things already exist that this sits between.

**The library.** `saved_days` holds 148 imported playbook days plus whatever
people have kept out of their own trips. A day is a dateless value — stops,
order, gaps, no ids (ADR-029) — and `readableSavedDay(savedDayId, readerId)`
defines exactly who may see one: your own days, plus anyone's published day. A
day nobody may read comes back as "no row", indistinguishable from one that
never existed.

**The assistant's approval loop.** Write tools are collect-only: `execute`
pushes a `RawToolIntent` and returns `{queued:true}`, and nothing in a turn can
write. The only path to a commit is the user clicking Approve on `ProposalCard`,
which posts to `POST /ask/apply`. That endpoint re-parses every command it is
handed and commits them as one batch — one history entry, one undo (ADR-013).

So the answer to Mitchell's stated worry — *"always ask the user before doing
it"* — is **already structural and needs no prompting to hold.** A tool that
collects cannot write; `minimumRoleFor()` already forces `editor` the moment any
write tool is offered; and the card is the only door. What prompting still owes
is narrower and is not a safety property: search before proposing, and propose
one day per turn so the card stays readable.

## The problem this ADR actually exists for

`AssistantProposal.commands` is closed over `BatchableCommand`, and
`parseApprovedCommands` re-parses each element at the apply door. The obvious
implementation is therefore to have the tool expand a playbook day into
`AddDay + AddActivity[]` and post it as ordinary commands.

**That silently bypasses the adds ledger.** `recordAdd` runs only inside
`insertSavedDay`'s `alsoInSameTransaction` hook (`savedDays.ts:573-590`). An
assistant-inserted day would never reach `saved_day_adds`, so the leaderboard
would not see it. `SPEC.md` §15 is blunt about why that matters — *"a build that
counts raw inserts will produce a different and gameable order"* — and M11b
built the ledger, the `addCounts` rule and three negative gate cases precisely to
make the board mean something. This would open a second, uncounted insert path
from a direction M11b never anticipated.

The mirror-image fix is worse. Letting the client post `{ savedDayId }` beside
its commands and claiming a ledger credit for it makes board position
**client-mintable**: `/ask/apply` has no server-side proposal store —
`proposalId` is logged, never persisted — so the endpoint cannot verify that a
claimed add corresponds to anything the model actually proposed. The existing
trust model ("re-parse the commands; the client could have posted these
commands directly anyway") holds for commands, because a command is something
the user is always allowed to issue. It does not transfer to a ledger credit,
which is something the user is specifically not allowed to mint.

## Decision 1 — the proposal carries the day by reference; the server expands it

`AssistantProposal` gains `inserts: { savedDayId, name }[]`, and
`ApplyProposalRequest` gains the same field. The commands for an inserted day
are **not** carried on the wire and **not** taken from the client.

On apply, for each entry, the server does what the manual insert path does:

1. `readableSavedDay(savedDayId, actorId)` — a hallucinated id, a private day and
   a withdrawn day all fail closed as the same 404, which is the property that
   function already exists to guarantee;
2. `insertCommands(saved, tripId)` — the same exported function the manual path
   uses, so the two cannot disagree about what inserting a day means;
3. append those commands to the same batch, and register `recordAdd` on
   `executeTripCommandBatch`'s existing `alsoInSameTransaction` hook, gated by
   the unchanged `addCounts`.

One batch, one history entry, one undo — the property `apply/route.int.test.ts`
already asserts — with the ledger written in the same transaction, which is the
property `savedDayAdds.ts` already exists to guarantee. Neither is a new
mechanism; both are the existing ones, reached from a second caller.

**What this buys, stated plainly:** the model never names a place. It names a
row, and the server reads that row. Every stop that lands in the trip is a stop
a human or the content importer wrote and the geocoder resolved.

**Rejected: a second proposal shape.** A fourth `AskToolSet`, a new `AskEvent`
member and parser, a second card and status machine, and a second apply
endpoint. It buys nothing here — the outcome of an insert *is* a command batch —
and it would put a second door next to the one door `/ask/apply` deliberately is.

**Rejected: two batches.** Calling `insertSavedDay` from the apply handler keeps
the ledger correct and costs the atomicity: two `executeTripCommandBatch` calls
are two history entries and two undos, so approving one proposal would take two
undos to reverse.

## Decision 2 — `search_playbooks` is a read tool, and its visibility set is `readableSavedDay`'s

Earned under ADR-022 §1's rule — *"a new tool is earned by a new computation or a
new capability boundary — never by a new phrasing of a question"* — as a
**capability boundary**: it reads a corpus outside the trip, which no existing
tool can reach. `read_trip`, `read_day` and `find_free_time` are all confined to
the current trip by construction.

Two constraints, both structural rather than prompted:

- **No `tripId` parameter**, per ADR-022 §3. Identity arrives through
  `contextSchema` only, so "search on behalf of another trip" is not expressible.
- **No `ownerId` parameter, and the visibility set is exactly
  `readableSavedDay`'s** — the caller's own days plus published days. Narrower
  and the model proposes days the apply door then 404s on; wider and the tool is
  a way to enumerate what people have kept private, which is the exact attack
  `readableSavedDay`'s WHERE clause is written to defeat.

## Decision 3 — `insert_playbook_day` is a hand-written write tool

This is the amendment, and it is the part that needed Mitchell's approval rather
than an architect's judgement.

ADR-015 §2 established that tool families are **derived**, never hand-written, so
a tool schema cannot drift from the command it executes. ADR-022 §1 amended that
for read tools on the grounds that **a read tool executes no command, so the
rationale does not transfer.**

`insert_playbook_day` is a write tool and is not derived from `BatchableCommand`.
It takes `{ savedDayId }`, collects an intent, and executes nothing. The
commands it eventually becomes are minted **server-side** by `insertCommands`,
which is derived from the contract in the ordinary way and is shared with the
manual insert path.

So ADR-022's argument applies unchanged: **the tool executes no command, so there
is nothing for its schema to drift from.** What would drift — the shape of
`AddDay + AddActivity[]` — is generated by code neither the model nor this tool
can influence. The derivation rule keeps its teeth exactly where it had them.

The narrow reading is recorded so this does not become a licence: a hand-written
write tool is permitted **only** when it names a server-side row and the server
mints the commands. A hand-written tool that carries command fields from the
model is still forbidden, and is still what ADR-015 §2 is about.

## Consequences

- **The ledger gains a second writer, and it is the same writer.** Both insert
  paths reach `recordAdd` through `executeTripCommandBatch`'s transaction hook,
  and `addCounts` is unchanged and uncopied. An assistant insert into an undated
  trip does not count, for the same reason a manual one does not.
- **`ProposalCard`, `describeProposedChange` and `ID_FIELDS` are untouched.** The
  insert is described at propose time as a sentence like any other change; the
  card renders it with no new status, no new branch.
- **KI-81 is narrowed, not closed.** An approved plan's *invented* place names
  remain ungrounded — `search_places` is still owed — but the assistant now has
  one path by which everything it adds is grounded by construction. That is the
  argument for building this before the grounding work rather than after.
- **A new failure mode, deliberately visible:** a day published when the model
  searched and withdrawn before the user clicks Approve fails the apply with the
  same 404 the manual dialog already handles. The proposal is not a hold on the
  row, and nothing here pretends otherwise.
- `simulatedModel.ts` needs a branch, or the flag-off path — which is every
  Vercel environment until `ai-live` is switched on — cannot exercise the flow
  at all.
- The response envelope is still not in `packages/contracts` (KI-22). `inserts`
  is added to the local `AssistantProposal` in `writeTools.ts` and its hand-kept
  mirror in `apiClient.ts`; this ADR does not reopen that, but it adds one more
  field to the pair KI-22 is about.
