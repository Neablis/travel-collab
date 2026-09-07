### KI-2026-09-03-b — `NotebooksMenu`'s inline-style `eslint-disable` cites a constraint that does not apply to `apps/web` — RESOLVED

**Resolved 2026-09-07.** The comment block above the scroll container and the
`eslint-disable-next-line no-restricted-syntax` reason on the `style={{ maxHeight: … }}`
line were rewritten to state the one load-bearing fact — Radix measures
`--radix-popover-content-available-height` per open against the live viewport, so no static
token can hold it — and the `_ds_bundle.css` / no-JIT clause was dropped entirely. **The
directive itself was kept**, and `docs/guidelines/design-system.md` gained the boundary this
entry asked for, stating both halves once: the `.design-sync` no-JIT rule governs artboard
HTML and not `apps/web`, and a half-step like `size-5.5` is house style, not a bracketed
arbitrary value.

*Correction to this entry's own framing, found while reproducing it:* the offending clause
is not in `RULES.md` (which has six rules and no §11) but in `SPEC.md` §11's "Notebooks is a
menu, not a tab" subsection, verbatim — *"Do not use arbitrary Tailwind values (`max-h-[…]`)
here — this page loads the precompiled `_ds_bundle.css` with no JIT."* The implementer copied
it faithfully; the falsehood entered when "this page" was re-anchored from the artboard to the
React component. `DS-UPSTREAM.md` U4 settles it: *"In the real app the JIT handles them, so
this is a design-file constraint, not a product bug."*

**Proven by:** (1) compiling the app's own stylesheet —
`npx @tailwindcss/cli -i src/app/globals.css -o out.css` emits
`.max-w-\[calc\(100vw-2rem\)\] { max-width: calc(100vw - 2rem) }` from `ShareButton.tsx`,
i.e. bracketed values are *not* inert in `apps/web`, and `.size-5\.5` compiles too;
(2) deleting the directive reproduces `no-restricted-syntax` — *"No inline styles — use
tokens"*, a token rule with no JIT component — at the `style` line both before and after the
rewrite, so the escape hatch is still load-bearing and still correct;
(3) `grep -rn "§11" apps/web/src` now yields no citation invoking a styling or compilation
constraint — every remaining one is a SPEC product-rule reference. `pnpm --filter web lint`,
`pnpm --filter web typecheck`, and `NotebooksMenu.test.tsx` (10 tests) all pass.

No regression test: the bug class is the truth of a sentence in a comment, which no assertion
can check in general. The one mechanizable slice — a source wall forbidding the no-JIT clause
in `apps/web/src` — is already owned by KI-2026-09-05-v, whose proposed mechanism (teaching
the lint rule the geometric class, plus `reportUnusedDisableDirectives`) subsumes it.

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
