# Comments: JSDoc on the symbol, `//` for the story

Answers: **which of my two comment styles goes where, and what does the
docstring wall actually demand?**

This repo used to have no answer. Both styles were in use, deliberately and
inconsistently — `widgetMatches`, `MacroNodeView` and `WidgetFilter` carried
real JSDoc while `railList`, `openSeededPage` and most e2e helpers carried `//`
blocks — and that was fine until a pre-merge check started scoring one of them
as zero. **Mitchell answered the question on 2026-09-22: JSDoc is the
convention, and the 80% floor is worth having** (KI-2026-09-20-i for the three
options that were on the table, KI-2026-09-22-a for the work).

What follows is that decision, written down so a codemod, a wall or a reviewer
is applying a rule rather than guessing at one.

---

## The rule, in three lines

1. **Every exported function and class carries a `/** … */` block attached to
   it.** That is the wall (`scripts/check-docstring-wall.mjs`, in `pnpm lint`).
2. **`//` above the symbol is still right** — for a decision, a citation, a
   measurement, a war story. It goes **above** the JSDoc, not instead of it.
3. **Non-exported helpers are free.** Document them when they are worth
   documenting. Nothing counts them.

## Why the split, rather than one style

The two comment styles are answering different questions and always were.

**JSDoc answers "what is this and what do I get back?"** It is attached to the
symbol, so an editor shows it at every call site, `tsc` associates it with the
signature, and a reader who has never opened this file gets it for free. That
is the question a caller asks.

**`//` answers "why is it like this?"** — which is the question the *next*
maintainer asks, and it is frequently the more valuable half. This repo is
full of comments that only make sense as prose: *why* the wave-gate regex
matches what it does, *why* `resolve` and not `join`, *why* a blocked lane
never withholds a PR, *why* the cheap model tier cost more than the one it
avoided. None of that belongs in an `@param`.

Asking for JSDoc is therefore **not** asking anyone to delete a `//` block or
reword it into tags. It is asking for one sentence the callers get, on top of
the reasoning the maintainers get.

## The shape

```ts
// ADR-019 amendment, 2026-08-25: every model call goes through this function,
// and `eslint.config.mjs` enforces that nothing else may import the gateway.
// The cheap tier is deliberately not the default — M20 measured it re-asking
// for the same tool twice, which cost more than the tier it was avoiding.
/**
 * The model to use for `kind`, already resolved against the current plan's
 * entitlements. Throws when the caller has no model available at all, which
 * is a configuration error rather than a user-facing one.
 */
export function selectAiModel(kind: AiCallKind): AiModel {
```

The ordering is not arbitrary. The `//` block sits furthest from the signature
because it is the part a caller can skip; the JSDoc sits against the signature
because it is the part a caller needs. A hover shows the JSDoc and not the
war story, which is the right split for a hover.

**One sentence is enough.** A wall that produces ceremony gets routed around.
`/** The trip's days, oldest first. */` is a complete and good docstring.

**Tags are optional and mostly unnecessary.** TypeScript already carries the
types; `@param city - the city` earns nothing. Reach for `@param` only when a
parameter needs a caveat the type cannot express, `@returns` when the return
needs one, `@throws` when throwing is part of the contract, and
`@deprecated` — which is load-bearing, because editors strike the symbol
through at every call site.

## What the wall counts, and what it does not

`scripts/check-docstring-wall.mjs` (runs inside `pnpm lint`):

| | |
|---|---|
| **Scanned** | `apps/web/src/**`, `packages/*/src/**`, `.ts` and `.tsx` |
| **Counted** | `export function`, `export class`, `export const f = () => …` |
| **Not counted** | types, interfaces, enums, plain constants, re-exports |
| **Not scanned** | `*.test.*`, `*.spec.*`, `*.d.ts`, generated trees |

Types and interfaces are **not** counted, and that is deliberate rather than an
oversight: the pre-merge check this mirrors counts functions, and a rule
demanding a sentence above each of `packages/contracts`' exported Zod schemas
would produce 267 sentences nobody asked for. Document a type when the type is
not self-evident — which is a judgement, not a wall.

E2E helpers are out of scope for the reason KI-2026-09-20-i recorded before
the decision was made and which survives it: converting them *"for a number
rather than for a reader"* would make those files internally inconsistent.

## The backlog, and why you will not be asked to clear it

470 exported functions and classes predate the decision — 52.6% documented,
measured 2026-09-23. They are listed in `scripts/docstring-wall-baseline.json`
and the wall ignores them.

KI-2026-09-22-a rules out a big-bang conversion in writing, and the reason is
worth repeating: **the prose is already written in every one of those files.**
What is wrong is its shape. Touching 470 files to move text that already says
the right thing is a large risky diff that improves nothing a reader would
notice.

So: **apply it as you touch files.** If you are already editing a function in
the baseline, give it a docstring and delete its baseline line. If you are not,
leave it.

**The backlog can only shrink, and that is enforced.** A baseline entry whose
symbol has since been documented, renamed or deleted fails the wall with
*"baseline entry is stale — delete this line"*. There is no way to document a
symbol and silently leave the grandfathering behind, and no way to re-add one
to a file that has been cleaned. It is the same mechanism
`reportUnusedDisableDirectives: "error"` provides for the test-quality backlog
(KI-2026-09-02-b) — a grandfathered list nobody is forced to prune is a
backlog that only grows.

## The pre-merge check this is reconciled with

CodeRabbit's **Docstring Coverage** check is configured explicitly in
`.coderabbit.yaml` rather than left on its default, so the 80% floor is a
number this repo chose. It scores **the functions a PR changes**, not the
repository — measured across three PRs: 9 functions across 7 files (#198),
72 across 17 (#199), and #201's five links. That settles the one question
KI-2026-09-22-a left open (*"repo-wide, where it stays red for months, or
changed files, where it is meaningful from the first PR"*): it was already
changed-files, so the floor is meaningful from the first PR and no ratchet is
needed.

The check and the wall are not redundant. The check is a **percentage on
changed code**, so a PR can clear it while leaving one function bare. The wall
is **absolute on new exports** but blind to everything grandfathered. Between
them: nothing new lands undocumented, and the backlog cannot grow.

## If the wall is wrong

It is a regex over source text, like every other wall here, so it can be. If it
demands a docstring on something that genuinely should not have one, say so in
the PR and add the symbol to `scripts/docstring-wall-baseline.json` by hand with
a comment in the description — the entry shows up in the diff as an added line,
which is the review signal a line-level `eslint-disable` gives. Do not reach
for `--update-baseline` to clear a failure: it rewrites the whole file and
buries the new entry among 470 old ones.

---

**See also:** `docs/guidelines/quality-enforcement.md` (what every change must
clear), `AGENTS.md` (the law), KI-2026-09-20-i (the three options and why the
check behaves as it does), KI-2026-09-22-a (the decision and the remaining
work).
