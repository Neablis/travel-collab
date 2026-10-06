# M46 — A trip has a conversation, with the people taking it

**Status:** **Proposed 2026-10-06, placed after M45. Not scoped yet**: the decisions below are
recommendations and none has been answered. Minted from `docs/candidates.md` (see
`docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*). It is the largest new surface
in this set, and the first feature that would generate notifications. That is why it comes after
the persona work (M38) and the phone work (M39), both of which it uses.

## Why this exists

Mitchell, 2026-10-04: *"a chat for a trip with the others taking the trip"*. Collaborators
coordinate outside the app today, so the conversation that explains a plan is not stored anywhere
near it.

Candidate absorbed (deleted by this gate):
- *A chat for a trip, with the people taking it* (2026-10-04)

## Decisions it needs (recommendations; none answered)

1. **Messages are their own store, not trip events.** They are conversation, not plan state, so
   they stay out of History, replay and undo (ADR-012). The ADR-064 boundary (a suggestion is not
   planning state until accepted) is the precedent.
2. **Every member may read and post**, including suggesters and viewers. A viewer can talk about a
   trip without editing it. Removing someone (KI-2026-10-05-h) cuts their access immediately.
3. **A message may link to one day or one stop**, by id. The link renders as a chip that focuses
   the board. A deleted target renders as plain text.
4. **Realtime uses the existing events poll**, with a `chatRev` counter like `suggestionsRev` and
   `accessRev` (ADR-064, ADR-065). There is no new transport.
5. **Notifications start in-app**: an unread count on the trip and on the home card. Email and
   push are separate decisions, and push depends on M39's service worker.
6. **Moderation:** authors can edit and delete their own messages, the owner can delete any, and
   a report reaches the admin reports panel (M12). A soft-deleted trip's chat follows ADR-016's
   retention.

## Scope

- A chat store, routes, a trip-level chat panel, links to days and stops, unread counts, and
  report and delete actions.
- Personas from M38 on every message.
- Public API endpoints, if the API guideline's checklist calls for them.

## Out of scope

- Direct messages between two people.
- Attachments and images.
- Email digests and push notifications.

## Exit gate

- [ ] **Decisions 1–6 are answered and recorded here**, with an ADR for the store.
- [ ] **No chat write touches the trip's event log**: an integration test compares the log before
      and after a conversation.
- [ ] **A removed member can neither read nor post from their next request on**, which an
      integration test shows.
- [ ] **A second member's open page shows a new message within one poll**, in an e2e with two
      contexts.
- [ ] **A reported message reaches the admin reports panel.**
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`.**
- [ ] **[walk]** Two people on the PR preview, one on a phone.
- [ ] A retro is appended at gate close.
