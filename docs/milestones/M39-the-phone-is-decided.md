# M39 — The phone layout is decided once, and Caesura installs like an app

**Status:** **Proposed 2026-10-06, placed after M38. Not scoped yet**: it opens with a design
critique whose output is its scope. Minted from `docs/candidates.md` (see
`docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*).

## Why this exists

The phone layout has been settled piece by piece in KI fixes, and five open entries say they need
a layout decision rather than a fix. Mitchell, 2026-09-25: *"I want to do a design critique soon
too, so we can combine those layout issues."* The PWA candidate (2026-10-02: *"add the PWA to
potential future work"*) depends on that critique. Its second tier, *"feels like an app"*, is
mostly the same phone-layout work, and `viewport-fit=cover` exposes the missing top inset. The
phone's missing conflict state (DRIFT §8) is design-owed work on the same screens. These go
together because deciding them separately would give three answers to the question of what a
phone shows.

Candidates absorbed (each deleted by this gate):
- *Design critique: phone and tablet layout, decided once* (2026-09-25), which carries
  `KI-2026-09-24-i`, `KI-2026-09-25-f`, `KI-2026-09-24-j`, and `KI-048` items 3 and 5
- *Caesura installable as a phone app, as a PWA and not a store release* (2026-10-02): the
  **installable** and **feels like an app** tiers only
- *The phone has no conflict state* (2026-09-01)

## Decisions it needs (recommendations; none answered)

1. **The critique comes first and is a design-sync session.** Its output is one decision per bullet
   of the critique entry, recorded in the KI entries or as a SPEC amendment through the design
   sync. `.design-sync/**` is a build input. Nothing is built until those decisions exist.
2. **What a trip opens to on a phone** (`KI-2026-09-25-f`). *Recommended:* Plan, not the Overview
   document. SPEC §24 says Overview and makes no phone exception, so this is a SPEC change.
3. **Do tablets keep the 44px touch floor?** (`KI-2026-09-24-j`). *Recommended:* yes, for any
   pointer-coarse device, whatever its width.
4. **The service worker caches static assets only.** It never caches `/api/**`, `/s/**`,
   `/invite/**` or `/monitoring`. It is hand-written because the build is Turbopack (the MapLibre
   worker in `scripts/copy-maplibre-worker.mjs` is the precedent). Offline trip data reverses
   ADR-012 and ADR-046 and stays out of this milestone.
5. **Push notifications stay out.** Nothing generates a notification yet. M46's chat is the first
   feature that would, so push belongs there or after it.

## Scope

- The critique and its recorded decisions.
- The phone and tablet fixes those decisions call for, closing the KIs above.
- The phone conflict state, built to whatever design the critique produces.
- `app/manifest.ts`, PNG icons from `scripts/generate-og-assets.mjs`, a `viewport` export with
  `viewport-fit=cover` and both insets handled, and a static-asset service worker.

## Out of scope

- Offline trip data, push notifications, and app-store wrappers (TWA or iOS).
- *Save light: move Retry into a popover*, which stays a candidate.

## Exit gate

- [ ] **The critique is held and every bullet has a recorded decision**, with links from each KI
      entry.
- [ ] **`KI-2026-09-24-i`, `KI-2026-09-25-f`, `KI-2026-09-24-j` and `KI-048` items 3 and 5 are
      resolved** (moved to `resolved/`) or explicitly re-scoped by the critique.
- [ ] **The phone shows a conflict state**, with a test seen red without it.
- [ ] **Caesura passes Chrome's installability check**: a manifest with icons, a service worker
      and a viewport. An e2e or a Lighthouse assertion records this.
- [ ] **The service worker never caches an API or token route**: a unit test over its route
      matcher was seen red with `/api/` allowed.
- [ ] **The e2e specs pass on `pnpm --filter web test:e2e:ci-like`**, including the `phone`
      project.
- [ ] **[walk]** Installed to a real iPhone and a real Android home screen. Sign-in, opening an
      emailed invite link, and long-press drag on the board are each walked and recorded. These are
      the open questions from the PWA entry, and none of them has been walked on a device yet.
- [ ] A retro is appended at gate close.
