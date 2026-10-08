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

   > **Amended 2026-10-03 (Mitchell: *"Let vercel handle abuse"*).** The per-IP limit is the
   > JSON API's, and stays. **The server-rendered HTML is not metered by the app**: the day
   > page, Discover, the city and country pages, and `/sitemap.xml` read in-process (SEO pass,
   > spec 2026-10-02 D5), with no app-level limiter in the render path. Abuse of those routes
   > is the Vercel firewall's to stop, at the edge. Fetching the HTML can therefore read what
   > the API would have refused on quota; that is accepted. If abuse ever shows up in the
   > database, the answer is an edge rule first, and a render-path limiter only after that.
   > Such a limiter would answer with a 429 page, never a 404, so it cannot become an oracle
   > for a private day.
4. ~~**The library stays pseudonymous.** Authors are shown as the `displayNameFor({ userId })`
   handle, and the preview cards print that same handle.~~ A card never reveals more than the
   page does.

   > **Amended 2026-10-02 (Mitchell).** The library names people by a **safe public name**: first
   > name and last initial ("Dana Reyes" → "Dana R."; a one-word name as it is), from the chosen
   > display name (`users.display_name`, M17) if set, else the sign-in name (`users.name`). Never
   > the email or anything derived from it. An account with no usable name — blank, or containing
   > "@" — keeps the handle. This covers authors and reviewers on every library surface: the
   > shared day, Discover cards, the board, a profile, review bylines, the day-changed banner and
   > the link-preview cards. One function, `publicNameFor` (`lib/displayName.ts`), decides it, so
   > a future username changes one place. A profile with nothing shared and no adds is still
   > "A traveler" (`publicAuthor`), so a typed URL cannot learn whether an account exists or
   > what it is called. The public REST API (`GET /v1/discover/playbooks`) does not carry the
   > name.

   > **Amended 2026-10-08 (M38 D2, Mitchell).** The chosen display name is used only when its
   > owner has opted in (`users.public_display_name`, *Show my display name on public pages* on
   > Account). Otherwise the safe public name comes from the sign-in name. The opt-in is
   > selected in the read (`ownerNames` and `publicNamesOf` in `server/playbooks.ts`, and the
   > referral card's lookup), so no resolver downstream can forget it. Migration `0044` opted in
   > everyone who already had a display name, because the library printed it before the column
   > existed. No public name changed at deploy, and a name chosen afterwards starts private.
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

- ~~An unpublish or a moderation takes up to an hour to leave our edge cache. This is the same
  trade-off the invite card made. Chat apps keep their first unfurl longer than that anyway.~~
  **Superseded 2026-10-03 by ADR-063:** the library's reads and cards are cached for a day, and
  an unpublish, a delete or an operator's hide clears them at once. Chat apps still keep their
  first unfurl as long as they like.
- The library is crawlable. Whether it should be indexed is an open candidate in
  `docs/candidates.md`, not decided here.
- A new public endpoint means new load from people who are not customers. The per-IP ceiling
  bounds it, and the CDN does not cache these JSON reads, because they vary by session. The
  server-rendered pages and the sitemap are bounded by the Vercel firewall instead (decision
  3, amended 2026-10-03).
