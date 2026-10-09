### KI-2026-10-09-c — on a phone, Discover's filter bar pins underneath the app header

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
