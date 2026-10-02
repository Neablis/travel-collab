# ADR-061: The playbook library is readable without an account

**Status:** **Accepted — 2026-10-02.** Mitchell asked for it. This records the shape.
**Deciders:** Mitchell (product); Claude — drafted
Amends: the M11b pages' "signed-in surfaces" note (`(app)/playbooks/page.tsx`), and spec
2026-09-27 §4, which kept `/playbooks/*` previews out of scope because the pages were behind
sign-in.
Related: **ADR-024** (`proxy.ts` as the request seam), **ADR-031** (hidden, not greyed),
**ADR-059** (the cache is expendable), spec `docs/specs/2026-10-02-public-playbooks-design.md`.

## Context

> I want to be able to share them with people who aren't signed up, they can see them, they can
> browse other playbooks, and when they are ready to add them it prompts them to sign in or sign
> up. The link should have a correct open graph preview.

Before this, `/playbooks/*` sent a signed-out visitor to `/signin`, and every read behind it
answered 401. A link to a playbook was useless to anyone without an account, and an unfurler
saw only the site card.

## Decision

1. **Same URLs, made public.** `/playbooks`, `/playbooks/day/<id>`, `/playbooks/profile/<id>`
   and `/playbooks/board` leave `proxy.ts`'s matcher. A link copied by a signed-in reader is
   the link a stranger opens, so there is no second set of routes to keep in step.
2. **Reads open, writes do not.** The GETs behind those pages serve a caller with no session:
   - Discover, board, profile
   - a saved day and its reviews
   - the place search

   A signed-out reader is **a reader who owns nothing**. They get the published, unmoderated
   half of `readableSavedDay`'s rule, the `everyone` scope, `mine: null` on reviews and
   `meUserId: null` on the board. A private or moderated day stays the same 404 it is for
   another account, so nothing new can be enumerated. Every write still answers 401.
3. **Anonymous reads are rate-limited per IP** (`publicLibraryQuota`), in Postgres like every
   other limiter (ADR-059 decision 1). Signed-in reads are not charged.
4. **The library stays pseudonymous.** Authors are shown as the `displayNameFor({ userId })`
   handle, and the preview cards print that same handle. A card never reveals more than the
   page does.
5. **Signed-out readers do not see controls they could only fail at** (ADR-031). That means no
   Yours/Saved scopes, no Report, no review composer and no tab bar. **Add to a trip** is the
   exception and stays. It is the thing the page exists to sell, so it opens a sign-in or
   sign-up prompt and banks a same-origin marker. When the reader returns signed in, the add
   dialog opens. The marker only opens the dialog and never adds anything.
6. **Previews, with the generic card on any miss.** Day, profile and city cards follow spec
   2026-09-27 §2.2. A private, moderated or unknown day, an author with nothing shared, or a
   city with no published days all draw the generic Playbooks card. So the routes cannot
   confirm a private day exists, and a crafted `?city=` cannot print arbitrary text on a
   branded card.

## Consequences

- An unpublish or a moderation takes up to an hour to leave our edge cache. This is the same
  trade-off the invite card made. Chat apps keep their first unfurl longer than that anyway.
- The library is crawlable. Whether it should be indexed is an open candidate in
  `docs/candidates.md`, not decided here.
- A new public endpoint means new load from people who are not customers. The per-IP ceiling
  bounds it, and the CDN does not cache these JSON reads, because they vary by session.
