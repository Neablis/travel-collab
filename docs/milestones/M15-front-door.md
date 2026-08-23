# M15 — Front door

**Status:** Not started. Phase 2 by execution, Phase 3 by number. Added
2026-08-23 from the design sync; **executes immediately after M10's gate and
before M9** — ADR-021.

## Why this exists

The product has no front door. An unauthenticated visitor to the deployed app
gets `<Heading>travel-collab</Heading>` and a link to NextAuth's default sign-in
page (`app/page.tsx:205-217`). A signed-in one has no way to sign out at all:
`server/auth.ts` exports `signOut` and nothing in `apps/web/src` calls it.

The 2026-08-23 design sync designed the whole surface — landing, sign-in,
sign-up, first run, account menu — with copy. This milestone builds it.

It is deliberately **not** part of M10. M10's scope is an authenticated-user
visual pass over Home and the trip plan; a new unauthenticated surface is not
polish. See ADR-021 for the ordering argument and
`docs/design-feedback/2026-08-23-design-sync-review.md` for the reconciliation
this came out of.

## Scope

Design source: `.design-sync/handoff/design/Trip Planner Redesign.dc.html` —
`isLanding` (≈1469-1541), `isAuth` (≈1543-1582), `isFirstRun` (≈1584-1640), the
account `Popover` (≈94-103, handlers ≈3091-3095). Copy is in the file; do not
invent product copy (`.design-sync/handoff/README.md` says the same).

1. **Landing page.** Hero, the product claim, two CTAs, the sample-itinerary
   card, the proof chips. Replaces the bare unauthenticated home.
2. **Sign-in and sign-up screens.** Custom, Google-only, replacing NextAuth's
   default page. They differ only in copy — one component, two modes, with the
   swap link between them (`authTitle` / `authSub` / `authScopeLine` /
   `authSwapPrompt` / `authSwapCta` in the DC).
3. **First-run screen.** "What are you planning, Sam?" — one field, "Start
   planning", and the "Roughly when?" row as a `<Preview>` shell. `CreateTrip`
   carries only a name and that does not change here (`SPEC.md` D4).
4. **Account menu.** The header avatar's `Popover`. **Sign out already ships in
   M10 Phase 8b** — this milestone inherits it and adds whatever "Your account"
   becomes, if anything.
5. **The states the design does not draw.** Sign-in failure, a revoked or denied
   Google grant, first-run with the network down. The DC shows the happy path
   only; these are ours to design and are part of the gate.

### Explicitly out of scope

- **"Look around a real trip"** — the landing hero's secondary CTA. It needs
  unauthenticated read of a real trip, which is **M11**'s share-link work.
  Omit it, or `<Preview>`-wrap it against a registry id pointing at M11. Do not
  build a bespoke public-read path for one button.
- **The Caesura rename** — lands in M10 Phase 8b.
- **An account model.** NextAuth's session carries a name, an email and a
  picture. Nothing beyond that exists, so nothing beyond that can be shown.
- **Invites.** "Invited to someone's trip? Sign in with the address the invite
  went to" is copy on the sign-in screen. Invites themselves are **M13**;
  `TripMember.role` is the literal string `"owner"`.

## Open questions — decide before or during, not after

1. **Is the one-field first-run screen intentionally different from the four-step
   new-trip wizard?** M10 Phase 7 Task 7.2 builds a four-step wizard (Where /
   When / Who / Shape) on a recorded decision from 2026-08-14. The design also
   contains a one-field first-run screen. So a user's first trip would take one
   field and their second would take four steps. That is defensible — first run
   should be frictionless — but it should be a decision, not something an
   implementer reconciles by guessing.
2. **May the landing copy sell M11 and M12?** *"Save the highlights when you get
   back, share them with the world, and let other travelers remix the best parts
   into their own adventures"* is fork-and-remix (M11) and community (M12),
   verbatim, on a page shown to strangers. The rest of the hero is honest about
   what exists. A landing page is the one surface where a `<Preview>` badge is
   not an option: ship it as aspiration, or trim the clause until M11 lands.

## Exit gate

- [ ] An unauthenticated visitor to `/` sees the landing page, not a bare heading.
- [ ] Sign-in and sign-up are our screens, not NextAuth's default page, and both complete a real Google sign-in end to end on the deployed app.
- [ ] A brand-new account lands on the first-run screen and can create its first trip from a name alone.
- [ ] A signed-in user can sign out from the header and returns to the landing page.
- [ ] Sign-in failure, a denied Google grant, and a network failure during first run each have a designed, tested state — no blank screen and no raw error.
- [ ] Nothing on the landing page claims an unbuilt capability that the two open questions above have not explicitly approved.
- [ ] "Look around a real trip" is absent or `<Preview>`-wrapped; no unauthenticated trip-read path was built.
- [ ] Every `<Preview>` added here is registered in `apps/web/src/lib/preview-registry.ts` with its real milestone, and the sync test passes.
- [ ] An e2e script covers landing → sign-in → first trip → sign out, and joins the suite prior milestones' scripts run in.
- [ ] `pnpm typecheck && pnpm lint`, unit, int and the full e2e suite green against a **production** build with `CI=true` (KI-27), including the narrow-viewport project.
- [ ] Retro appended here; `TODO.md`, this file's boxes and `docs/milestones/README.md`'s Current milestone all flipped in **one** commit (README's gate-close checklist).

## Retro

*(appended at gate close)*
