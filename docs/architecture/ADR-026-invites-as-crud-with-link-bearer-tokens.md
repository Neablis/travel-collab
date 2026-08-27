# ADR-026 — Invites live in Access CRUD, and the link is the credential

**Status:** Proposed (M11 link 3, 2026-08-27). Open to reversal; two of the
three decisions below are the ones most likely to be overturned in review.

**Supersedes nothing. Depends on:** ADR-003 (event sourcing is scoped to
planning), ADR-025 (a users table under JWT sessions).

## Context

M11 link 2 gave `TripMember` a role and made `AccessPolicy` enforce it, but
nothing could create a non-owner member: `TripCreated` mints exactly one
`owner` and no planning command adds to the list. Link 3 has to create them.

Three questions had to be answered before any code, and each has a plausible
alternative that a competent engineer could pick instead.

## Decision 1 — membership is CRUD, and the owner stays in the log

Invites and memberships are two ordinary tables, `trip_invites` and
`trip_memberships`, with audit fields. They are not events.

The obvious alternative is a `MemberAdded` / `MemberRemoved` planning event
pair, which would have kept one source of truth for `TripState.members`. It was
rejected because it puts invite logic inside Trip Planning, which the AGENTS.md
module map names as a drift signal in its own right ("Invite/permission logic
appearing inside Trip Planning") and ADR-003 already scopes away: the log is
the planning domain's source of truth, and Identity/Access are CRUD.

The consequence is that a trip's member list has two halves:

- the **owner**, derived from `TripCreated.createdBy` — unchanged, so eight
  milestones of existing trips need no backfill and no migration;
- **everyone else**, one `trip_memberships` row per accepted invite.

They meet in exactly one pure function, `mergeMembers`
(`apps/web/src/server/access/members.ts`), which is total over disagreement:
if a userId appears on both sides, the higher rank wins. That rule exists for
one failure mode — an owner demoted by a stray `viewer` row is the only state
here that cannot be repaired through the UI.

### Where the merge happens, and why not in the projection

The merged list is applied at the **read boundary** — `requireTripAccess`, the
`/api/trips` list, and the DTO a command returns — and never written into
`trip_details` or `trip_summaries`. Writing it there would have been simpler
to read, and it would have broken AGENTS.md invariant 2: the stored projection
must be rebuildable from the log alone, and a membership row is not in the log.
The golden rebuild test is what would have caught it; this way it never has to.

The command pipeline authorizes against the merged list too (`commands.ts`
step 3). The planning domain is untouched: `state.members` still comes only
from the log, and the merge happens on the way *into* the AccessPolicy seam,
which was already the only thing that interprets a role (invariant 6c).

## Decision 2 — the link is the credential; the email is a label

An invite carries 32 bytes of CSPRNG entropy, base64url, unique-indexed. Anyone
holding the link can accept. The invite's `email` is optional and is **not**
checked against the accepting session.

The alternative — refuse to accept unless the session's email matches the
invited address — is more restrictive and was rejected for two reasons. First,
the dev-login provider mints users with no email at all, so email-matching
would make the whole flow untestable end to end, and an untested invite path is
worse than a permissive one. Second, people routinely sign in with a different
address than the one they were invited at, and the failure mode ("this invite
isn't for you", on a link that is for you) is bad.

What remains: the token is unguessable, **single use** (the status flip and the
membership grant happen in one transaction, conditioned on `status = 'pending'`,
so two simultaneous accepts cannot both win), and **revocable**.

**This is the decision most worth overturning.** If invites ever go out by
email from the product itself, matching becomes nearly free and the argument
above weakens considerably.

## Decision 3 — the token is stored as issued, not hashed

Hashing would be the reflex, and the reflex is right when a token is a password
equivalent nobody needs to see twice. Here the owner's invite list has to be
able to re-show a link they already handed out — there is no email delivery, so
copying the link *is* sending the invite, and a hashed token could be shown
exactly once. The mitigations are that the only route returning a `TripInvite`
requires `owner`, and that `TripInvite` never appears in a DTO served to
anyone else (`TripAccess.invites` is empty for a non-owner, enforced server-side
and covered by `access/route.int.test.ts`).

This is the second decision worth overturning: a "reveal once" flow plus a
hashed column is a real alternative, at the cost of a link the owner can lose.

## Consequences

- Revoking an accepted invite **removes the membership it created**, in the
  same transaction. Anything else would make "revoke" mean "stop the link
  being reused", which is not what the word means to the person clicking it.
- `guard()` in `pages-guard.ts` now takes a **required** minimum role. It used
  to check membership with no role at all while fronting the Notebook page
  writes and the AI handler, so the first `viewer` this milestone created would
  have been able to write pages and drive the assistant. Required, not
  defaulted, so the next caller has to decide.
- An invite never offers `owner`. Transferring a trip is a different operation
  with different consequences and no milestone has asked for it.
- There is no expiry. An unexpiring, revocable link is one control; a second
  one nobody asked for would need a UI to explain it.
- No foreign key from `trip_memberships.user_id` to `users.id`, on exactly the
  terms ADR-025 set for `events.actor_id`. The reference is upheld at the
  sign-in seam instead — accepting an invite requires a session, and a session
  cannot exist without a user row.
