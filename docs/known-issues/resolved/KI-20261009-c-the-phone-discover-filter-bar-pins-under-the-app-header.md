### KI-2026-10-09-c — on a phone, Discover's filter bar pins underneath the app header — RESOLVED

- **Severity:** usability, phone. Discover's tabs and filters scroll under the header and are
  hidden once pinned.
- **Area:** `apps/web/src/components/playbooks/DiscoverScreen.tsx` (~:335), `sticky top-0 z-10`
  below `md`. `AppHeader` is `sticky top-0` with a higher `z-30`, at the same `top`.
- **Symptom:** found by reading the code during M39 Part 7; no screenshot yet. Below 768px, once
  the page scrolls, the filter bar sticks at `top: 0` and the AppHeader paints over it. This
  does not depend on the safe-area insets.
- **Why not fixed here:** outside KI-2026-10-09-a, which was about insets. It needs a check on a
  phone first.
- **Fix direction:** pin it below the header with the existing `.below-app-header` rule
  (`top: var(--app-header-height)`), as the trip header does. Then check that the stack does not
  eat too much of a short screen.
- **First noted:** 2026-10-09, M39 Part 7.
- **Proof (resolved 2026-10-24, KI sweep):** the fix direction, as written: the bar's
  `top-0` is now `below-app-header`, so it pins at `var(--app-header-height)` under AppHeader,
  as the trip header does. Reproduced first in the browser rather than by reading: a new
  `e2e/m26-phone-surfaces.spec.ts` case (phone project, 411×852), *pins its tabs and search
  under the app header, not behind it*, reads the sticky bar's computed `top` against
  AppHeader's height. On the old code it failed with `Expected: 56 Received: 0`, in the same
  place on its CI retry, in `pnpm --filter web test:e2e:ci-like e2e/m26-phone-surfaces.spec.ts`.
  With the fix it passes: `32 passed` across `m26-phone-surfaces`, `m39-installable` and
  `m12-discover`, no retries. **Not walked on a real phone:** on a 852px screen the pinned
  stack is AppHeader's 56px plus the bar (tabs and the search card, roughly 120px), about a
  fifth of the screen. Whether that is too much on a short phone is a preview call.
