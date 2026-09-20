# Building a screen from the design

The design lives in `.design-sync/handoff/`. This page is the order you read it
in, and the four traps that cost cycles when it is read in a different order.

It exists because building **one** screen — M20's operator console, PR #174 —
cost four review rounds and three wrong builds, and every one was caught by a
person or a wall rather than by the process (`KI-2026-09-14-c`, resolved by this
page). M26 builds around twenty screens from the same handoff.

---

## The order of operations

Five steps. The first three are reading, and skipping them is what the KI
measured.

### 1. Find the artboard

`.design-sync/handoff/README.md` carries a **route → artboard → spec** table.
Look your route up in it, open the design file at that line, and drive the
`startScreen` / `surface` / `plan` / `dataState` props listed in the README to
reach the state you are building.

Do not grep the design file for a heading you have guessed. That is what step 1
used to be, it works only once you think to do it, and the whole failure is that
nobody thinks to do it.

The table is generated — `node scripts/route-artboard-index.mjs --write` — and a
test fails when a gate is renamed out of the design file, when a line number
drifts, or when the app grows a route nobody has decided an artboard for. If you
add a route, that test is where you record what draws it.

### 2. Read `SPEC.md`'s prose for the same screen

The spec says what the design file cannot say out loud: why a thing is shaped
that way, what was rejected, what is deliberately undrawn.

**`SPEC.md` is ordered by date, not by section number, and is never
renumbered** — §18 begins before §17, §21–§23 sit after §24. Use the **Sections,
by number** index at the top of the file; do not grep `§17` and read forward,
which lands you in a different section. That index is generated too
(`node scripts/spec-section-index.mjs --write`) and a test keeps it honest.

### 3. Diff it against the milestone link that owns the screen, in writing

**Write down what is out of scope before writing any code.** One artboard
routinely draws several milestones at once and says nothing about which is
which: the operator console artboard drew M20's accounts panel and M21's revenue
strip, `Pays` and `State` columns, the underwater row highlight and per-tier MRR
side by side, none of it labelled. The only place that split was written down
was M20 link 7's own note, in a different file, which *predicted this exact
mistake* — and the prediction was not enough to prevent it.

The design's vocabulary carries concepts the current milestone cannot compute.
Copying a panel title copied the idea of an account being "underwater", which is
a comparison against income M20 had no income for. A component, its copy and its
tests were written around a word the milestone could not mean.

### 4. Run the surface's invariant sweep before you build

Some surfaces have a test that bans vocabulary or asserts a rule —
`admin.console.test.ts` is the worked example, `planVersions.fourthPlan.test.ts`
is the repo-wide one. Run it **first**. Banned vocabulary then fails in seconds,
instead of after a component has been named for it.

### 5. Then build

And when you think you are done, see *What a gate owes* below — because a gate
written only from the server can close green with the screen missing.

---

## Design ids are not domain ids

A filter, tab or chip id taken from an artboard's label set gets a name that
says **what the group means** — `entitled` / `unentitled` — never one that
spells a `PlanId`, an `Entitlement`, or any other domain enum member.

The console artboard's filter set (`all / paying / granted / free / past_due /
under`) became a `FilterId` union, and `case "free":` tripped
`planVersions.fourthPlan.test.ts`, which walks every source file for a
comparison against a plan id (ADR-045 rule 4). The filter id and the plan id
were different concepts wearing the same string. The wall caught it; the point
of this line is that it stops being rediscovered once per surface.

---

## Two traps that are invisible in either file alone

**A primitive's defaults decide whether copying the structure reproduces the
result.** The grant form's controls were put in a `flex-wrap` row exactly as
drawn and rendered one per line, because `Input` is `w-full` and a `w-full` flex
item takes a 100% basis. The markup said row and the widths said column. Neither
file is wrong; the browser is where the disagreement shows. Look at the screen.

**A token NAME that does not exist emits nothing.** `globals.css` sets
`--color-*: initial`, so Tailwind's default palette is gone and `bg-brand-subtle`
or `text-muted` produce no rule at all — the control ships with a transparent
background. Since 2026-09-19 `scripts/check-color-wall.mjs` fails on a token
name `@theme` does not define, so this is caught in `pnpm lint` rather than by a
person on a preview. Take the names from `globals.css`, not from the design
file's own CSS variables, which are not always the same set.

---

## What a gate owes when a milestone owns a surface

**A milestone's exit gate can be written entirely from the server's behaviour
and never notice that a SURFACE is missing.** M20's 29 boxes covered every
entitlement rule, the resolver, the ledger and the console — and not one
required the account screen the design draws. It could have closed green with
every entitlement it built invisible to the person holding it.

> Mitchell, 2026-09-14: *"the exit gates are incorrect if it's in the designs but
> wasn't included in the gates."*

So: **when a milestone owns a surface in the design, its gate needs at least one
box a person could fail by looking at the screen**, not only boxes a test can
pass against the server. M26 marks those boxes `**[walk]**`; use that convention.

---

## Do not chase the screenshots

Preview attachments on a PR cannot be fetched from a cloud session —
`vercel.live` is denied by the egress proxy, and the Vercel MCP will not mint a
shareable URL for an attachment. **That denial is correct behaviour and is not a
problem to solve.** Three review rounds were once spent reporting it.

The screenshots are photographs of a design committed to this repository. Open
the artboard instead — step 1 above. Doing that produced, in one read, the four
missing pieces of the accounts panel and both missing lower panels that three
rounds of guessing had not.

---

## Related

- `docs/guidelines/design-system.md` — the tokens, components and walls the build
  is made of.
- `docs/guidelines/testing.md` — including why a geometry assertion outlives the
  layout it describes.
- `AGENTS.md` — the Definition of Done and its verification tiers. Note that
  `.design-sync/**` is a **build input, not prose**: a change there is not a
  prose-only change.
