### KI-2026-09-03-b — `NotebooksMenu`'s inline-style `eslint-disable` cites a constraint that does not apply to `apps/web`

- **Severity:** cleanup (no defect — the escape hatch itself is correct and the rendered
  menu is right; what is wrong is the stated reason, which teaches the next reader
  something false about this codebase).
- **Area:** `apps/web/src/components/trip/NotebooksMenu.tsx` — the comment block above the
  scroll container and the `// eslint-disable-next-line no-restricted-syntax --` directive
  on the `style={{ maxHeight: … }}` line beneath it.
- **What is wrong:** the justification says the Tailwind arbitrary-value form (`max-h-[…]`)
  is "explicitly warned off in §11 for a reason that applies to this page: it loads the
  precompiled `_ds_bundle.css` with no JIT, so an uncompiled utility lands in the DOM and
  silently does nothing." **That is true of the design canvas and not of `apps/web`.**
  `.design-sync/handoff/RULES.md` §11 is a rule about the handoff's own artboard HTML,
  which loads a precompiled bundle. `apps/web` builds Tailwind properly, with JIT — an
  arbitrary value there compiles like any other utility. The comment imports a foreign
  constraint into the app and states it as a fact about "this page".
- **Why the directive is still right, which is the part not to lose:** the value is
  `--radix-popover-content-available-height`, which Radix measures per open against the
  actual viewport. No static token can hold it, and `max-h-[var(--radix-…)]` would compile
  but is a worse expression of "a value that only exists at open time" than the inline
  style is. So **the escape is correct and should stay** — only the second half of its
  stated reason is wrong. Deleting the directive is not the fix.
- **Why this is filed rather than edited:** the same §11-in-`apps/web` confusion has a
  second face that is a live style question, not just a comment — off-4px-grid spacing
  steps like `size-5.5` are house style here (`LandingScreen.tsx`,
  `LandingFeatureBlocks.tsx`) and are **not** the same thing as a bracketed arbitrary
  value, though a reader of this comment would reasonably conclude both are banned. Fixing
  the comment in isolation leaves that half unstated. Worth one deliberate pass over where
  §11 does and does not apply, rather than a silent one-line edit inside an unrelated PR.
- **Fix path:** rewrite the comment to say what is actually load-bearing — a
  Radix-measured viewport value has no static token — and drop the `_ds_bundle.css` / no-JIT
  clause entirely. While there, check whether any other `apps/web` comment cites §11 as
  binding on app code (`grep -rn "§11" apps/web/src`), and consider a line in
  `docs/guidelines/` stating the boundary once: §11 governs `.design-sync/**` artboards;
  `apps/web` compiles Tailwind normally.
- **Cross-reference:** `.design-sync/handoff/RULES.md` §11, PR #126 (which added the
  comment), `.design-sync/handoff/SPEC.md` §11.
- **First noted:** 2026-09-03, while briefing M14's builder half — flagged as an open
  question in the session handoff rather than settled inside an unrelated PR.
- **2026-09-05 overnight review ([F-E09](../../reviews/2026-09-05-overnight-review/findings/F-E09-design-wall-backlog-lives-in-128-disables.md)):**
  stream E counted the population this entry is one member of — 128
  `eslint-disable-next-line no-restricted-syntax` directives in `apps/web/src`,
  71 of them excusing geometry — and names this entry as the evidence that
  hand-written reasons drift. Teaching the rule the geometric class would make
  `reportUnusedDisableDirectives: "error"` delete most of them, this one
  included. Filed as KI-2026-09-05-v.
