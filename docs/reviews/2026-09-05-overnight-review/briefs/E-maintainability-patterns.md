# Stream E — Long-term maintainability and coding patterns

Question: **Which coding patterns are working well, and which are causing
repeat issues?** Evidence-first: the repo has 40 open KIs, ~60 resolved ones,
and several retros — mine them for recurrence classes before reading code, so
you can name the pattern behind the repeats rather than the symptoms.

Read first:
- `ls docs/known-issues/{open,resolved}`; read the headings + Area lines of
  all of them (a `grep -h '^### \|Area:' -r docs/known-issues/` gets you there
  cheaply). Cluster them: what fraction are optimistic-queue / silent loss
  (KI-005, 090…), AI validation (009, 010, 022, 081, 082), layout/responsive
  (046, 085), test-quality (2026-09-02-b/d/e), design-wall, infra?
- `docs/retros/*.md` — the "what we learned" lines only
- `docs/reviews/2026-08-28-project-review.md` §1, §6 — what was found then;
  check which items were fixed (grep the code) and which were re-found later
- `docs/guidelines/{testing,quality-enforcement,design-system}.md`, `scripts/check-*-wall.mjs` — the walls that exist
- The biggest UI files: `components/board/TripBoardScreen.tsx` (1025), `lib/apiClient.ts` (999), `lenses/{TimelineLens,CalendarLens,MapLens}.tsx`, `home/NewTripWizard.tsx`, `trip/context/{TripProvider,FocusProvider,optimistic}.ts(x)`, `app/(app)/page.tsx` (495 — a page file that large is a smell), `playbooks/SharedDayScreen.tsx`
- `apps/web/src/lib/**` — what is shared, what is copy-pasted
- ESLint config (`apps/web/eslint.config.*`), `tsconfig.base.json` strictness

Concretely:
1. **Recurrence classes.** For each cluster: the underlying pattern, the KIs it
   produced, whether a wall/lint/test-layer could have prevented the class,
   and what that guard would be. This is the headline deliverable.
2. **`apiClient.ts` at 999 lines**: is it one client or N hand-written fetch
   wrappers? Is there a generated or contracts-derived typed client (AGENTS.md
   promises "the typed API client" and MSW mocks "generated from contracts")?
   Count the routes in `app/api/**` vs the functions in `apiClient.ts` — is
   every route hand-mirrored? What would collapse it?
3. **State architecture** (ADR-012, 013): `TripProvider` + `optimistic.ts` +
   `FocusProvider` — is there one source of truth for client trip state, or
   several (`useState` copies in lenses)? Are the 2026-08-28 send-queue
   fixes in and tested?
4. **Component patterns:** how many components take a `trip` prop vs read
   context; hand-rolled sheets/popovers vs `components/ui`; inline styles vs
   the color wall; `'use client'` at the top of things that could be server.
5. **Server patterns:** route handler shape — is there one `withAuth`/`withTrip`
   wrapper or does each route re-do session → trip → policy → parse → respond?
   Count how many routes repeat the same 20 lines.
6. **Test patterns:** ratio of tests to code per package; what `docs/testing-baseline.md`
   and `testing-inventory.md` say; tests that assert on their own inputs
   (the tautology class the 2026-08-28 review and CodeRabbit each caught once).
7. **Naming and boundaries:** does `packages/pages` belong in packages (it is
   imported by both server and UI — is it pure? does it import React?). Is
   `packages/predict` (1 LOC) dead? `packages/factories` vs `fixtures` overlap?
8. **Docs as code:** how many places restate the same rule (AGENTS.md, CLAUDE.md,
   guidelines, skills) and where have they already drifted? One example with
   both quotes is enough per drift.

Report two sections explicitly: **### Patterns working well** (keep doing) and
**### Patterns causing repeat issues** (each with its KI evidence and the guard
that would end the class).
