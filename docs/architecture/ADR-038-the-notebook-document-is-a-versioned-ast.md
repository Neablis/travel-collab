# ADR-038: The notebook document is a versioned AST, and a read that cannot understand it must never overwrite it

**Status:** **Accepted — 2026-09-03**, and it is the FIRST thing to build: every page written
before it lands is written in a format nothing can identify, so the cost of deferring it grows
with the number of documents. ADR-036 (page history) should follow it rather than precede it.
**Deciders:** Mitchell (product/eng); Claude (architect) — drafted
Related: ADR-035 (widgets carry bindings, so a document holds instances with arguments),
**ADR-037** (a widget module — this stores what that produces), **ADR-036** (page history;
it stores documents, so it inherits whatever this decides), Invariant 5

## Context

Mitchell, 2026-09-03:

> I almost think we need our own ast to handle the serialized version of a notebook, and be
> careful about versioning so we don't lose everyone's notebook on migrations

He is right, and the situation is worse than "we should add a version field". Checked against
`main` at `99512eb`:

```ts
export const PageContent = z.object({
  type: z.literal("doc"),
  content: z.array(z.unknown()).default([]),
}).passthrough();
```

**`z.array(z.unknown())` is not an AST. It is a hole with a type annotation.** Three
consequences, all live today:

1. **Nothing validates a node's interior.** `MacroNode` exists as a schema and is applied on
   exactly one path — `validateComposedPage`, defence-in-depth on the AI compose route.
   Everything else — the editor's own `getJSON()`, a restored page, a seeded template — writes
   whatever it likes and the contract accepts it.
2. **No stored page records the format it was written in.** `grep -i version packages/contracts/src/pages.ts` returns nothing. So the first time the node format changes there is no way
   to tell an old document from a new one, which means there is no way to write a migration
   that is safe to run twice or safe to skip.
3. **The repo already knows how to do this and pages are the exception.** Every event is
   versioned in its type — `ActivityAddedV1` carries `version: z.literal(1)` — precisely so
   the log can be replayed years later. Documents got none of that discipline, and ADR-036
   is about to put documents *into* that log.

### The specific way notebooks get lost, and it is not a migration

The dangerous path is not a bad migration. It is the ordinary one:

**read → render in the editor → autosave writes `getJSON()` back over the original.**

`PageScreen` autosaves on an 800 ms debounce. If the editor's schema does not understand a
node in the stored document, that node does not survive the round trip — and the autosave
then persists the lossy version over the good one. Nobody edited the widget. Nobody was
warned. The page simply has less in it than it did.

This becomes reachable the moment **link 6** adds `repeat` nodes: a page containing a repeater
opened by any client whose schema predates it — a stale tab, a rolling deploy, a rolled-back
release — is a page with its repeaters quietly removed on the next keystroke.

~~**This risk is asserted from reading the code, not from an observed failure, and it must be
tested before it is designed around.**~~

### MEASURED, 2026-09-03. It is neither of the two options this ADR offered, and it is worse

The test was written first, as this section demanded:
`apps/web/src/components/pages/editor/PageEditor.test.tsx`, *"PageEditor given a node type the
schema does not know (ADR-038)"*.

**TipTap does not throw, and does not drop the unrecognised node. It discards the entire
document.** `@tiptap/core@2.27.2`'s `createNodeFromContent` catches ProseMirror's
`RangeError: Unknown node type`, warns, and substitutes an **empty** document:

```js
console.warn('[tiptap warn]: Invalid content.', 'Passed value:', content, 'Error:', error);
return createNodeFromContent('', schema, options);
```

Fed `[ paragraph("written by the user"), repeat{…} ]` and given one keystroke, `onChange`
emits `{ type: "doc", content: [ { paragraph, text: "x" } ] }`. **The user's own paragraph is
gone.** `PageScreen` then autosaves that over the original 800 ms later.

So the blast radius is **the whole page, not the unrecognised node** — and the page does not
have to contain anything new for its author to lose it, only to be opened by a client that
does not know one node in it.

**Three things this changes in the decisions below:**

1. **Decision 4 is the primary defence, not belt-and-braces.** Decision 3 preserves unknown
   nodes on *our* parse, but TipTap has already thrown the content away before our serialiser
   is ever reached. Preservation alone protects nothing.
2. **The refusal has to be ours, upstream of mounting the editor.** There is no TipTap option
   that turns this into an error we can act on: `enableContentCheck: true` was tried and did
   not change the outcome, because `Editor.createView` catches the invalid-JSON error, emits a
   `contentError` event, and then re-runs the same fallback with `errorOnInvalidContent:
   false`. **`contentError` is a notification, not a veto.** That is what makes a
   contracts-side parser load-bearing rather than tidy.
3. **The trigger is much broader than `repeat`.** This does not wait for link 6 — see the
   vocabulary gap below.

### The v1 vocabulary is wider than decision 1's node list, and that gap is now the urgent one

`PageEditor` loads full `StarterKit`, so `bulletList`, `orderedList`, `listItem`,
`blockquote`, `codeBlock`, `horizontalRule` and `hardBreak` are all reachable **today** and
absent from decision 1's union. Two consequences, and the second is a shipping blocker:

- Under decision 3 they classify as `unknown` — safe, but a page with a bulleted list renders
  as a wall of "Something newer is here" placeholders.
- Under decision 4 that page **fails to round-trip and opens read-only.** Any notebook
  containing a list would become uneditable.

**Decision 1's list is therefore incomplete rather than minimal, and it must be widened to the
real v1 vocabulary before the editor integration lands.** Nothing consumes `PageDoc` yet, so
this costs nothing today and would cost real pages the moment it does.

A narrower instance of the same mistake: this ADR specifies `heading` levels **1–3**, while
`server/ai/pageTools.ts` accepts **1–6** today. An AI-composed level-4 heading is a hard parse
error, not an unknown node. Pinned by a test rather than left latent, and it needs a decision
— widen the AST, or narrow the compose tool.

### One deviation the implementation made deliberately, and it is right

The widget node's stored discriminator stays **`"macro"`**, not decision 1's `"widget"`. Every
page ever written uses `"macro"` — it is what `MacroNodeExtension` emits and what `MacroNode`
already describes — and since "existing rows have no `v` and are v1 by definition", a v1
document is *by definition* one containing `"macro"` nodes. Declaring the discriminator
`"widget"` would reclassify every existing widget on every existing page as unknown, which,
given the measurement above, would make those pages read-only or lose them. **Renaming the
stored string is a v2 migration — exactly the job the migration chain exists for** — and this
is ADR-037 decision 8 ("a widget's `name` is a stored identifier") applying to node types too.

## Decision

### 1. `PageDoc` is a closed, discriminated AST owned by contracts

Not "ProseMirror JSON we hope is fine". A real union, exhaustively parsed:

```ts
type PageNode =
  | { type: "paragraph"; content: InlineNode[] }
  | { type: "heading"; attrs: { level: 1|2|3 }; content: InlineNode[] }
  | { type: "widget"; attrs: { name: string; params: Record<string, unknown> } }
  | { type: "repeat"; attrs: { name: string; params: Record<string, unknown> };
      content: InlineNode[] }        // its content IS the row template (ADR-035 decision 4)
  | { type: "unknown"; raw: unknown } // decision 3
```

The editor keeps using TipTap; TipTap's schema and this AST are **two representations of one
format**, with an explicit conversion at the boundary rather than an assumption that they
agree. That conversion is the seam that makes the round-trip testable, which is the only way
the failure above gets caught.

### 2. Every document carries `v`, and it is written on every save

```ts
const PageDoc = z.object({ v: z.number().int().positive(), type: z.literal("doc"), content: z.array(PageNode) });
```

Migrations are a **pure ordered chain of `(doc) => doc` functions**, `v1 → v2 → v3`, applied on
read, in `packages/contracts` or `packages/pages` — no I/O, so they are trivially testable and
runnable over a fixture corpus in CI. A document is migrated in memory on read and persisted
at the current version on the next ordinary save. **No bulk migration job**, which is also what
keeps `0014`/`0015`-style undispatched-migration risk away from user content.

Existing rows have no `v`. They are `v: 1` by definition — that is the one inference this
design permits, and it is safe because it is the only version that has ever existed.

### 3. A node we cannot understand is preserved, never dropped

Unknown node types parse into `{ type: "unknown", raw }` carrying the original JSON verbatim,
and serialise back out **byte-identical**. The editor renders them as an inert placeholder
("Something newer is here") and refuses to let them be edited.

This is what makes a rolling deploy and a stale tab safe: an older client can open, read, and
even edit a document containing newer nodes without destroying them.

### 4. A document that fails to round-trip is never autosaved over

Belt and braces, and the rule that actually prevents the loss described above:

**Before the first autosave of a session, parse the stored document and re-serialise it. If
the result is not equivalent to what was stored, the page opens read-only with a visible
explanation and autosave is disabled for that page.**

A page that cannot be saved losslessly is a page that must not be saved at all. This is the
one behaviour I would not trade away for convenience: a reader who cannot edit is
inconvenienced; a reader who silently truncates someone else's notebook is a bug we would find
out about weeks later from a person who lost work.

### 5. The corpus test is the guard, and it grows with every version

A golden fixture per version — a real document exercising every node type that existed then —
asserting: it migrates to current, it round-trips, and **the migration is idempotent**
(running it twice equals running it once). Adding `v(n+1)` means adding its fixture; the
`v1…vn` fixtures stay forever, which is what stops version 6 from breaking version 2's
documents.

This is the documents' analogue of the projection-rebuild golden test, and it belongs in the
Definition of Done next to it.

## Consequences

- **A contract change with a real migration story**, which is the point. Invariant 5's
  protocol: own PR, changelog entry, consumers together.
- **`PageContent`'s `passthrough()` and `z.unknown()` go.** Anything currently relying on
  storing arbitrary JSON in a page breaks loudly at the boundary — which is the intended
  outcome, since today it breaks silently at the editor.
- **ADR-036 inherits this.** A page event stores a document; if documents are versioned then
  the log holds a version per event and replay migrates each. If this ADR is *not* accepted
  first, ADR-036 writes unversioned documents into an append-only log — the one place a format
  mistake is genuinely permanent. **Recommend this is accepted before link 9 starts**, ahead of
  the draft-durability question already blocking it.
- **`validateComposedPage` stops being special.** It becomes "parse the doc", the same call
  every other path makes, rather than defence-in-depth that only the AI route pays for.
- **Two representations to keep in step** (TipTap schema, `PageDoc`). That is the cost. The
  round-trip test is what makes it a cost rather than a liability.

## Alternatives rejected

- **Add a `v` field and keep `z.unknown()`.** Cheapest, and it buys nothing: you can tell
  which version a document claims to be while remaining unable to say whether it is valid, and
  migrations would be rewriting a structure nothing describes.
- **Trust the editor's schema as the format.** It is the status quo. It puts the definition of
  a stored, shared, soon-to-be-event-sourced artefact inside a UI dependency, and ties the
  document format to a TipTap upgrade.
- **Bulk-migrate on deploy.** One irreversible pass over everyone's content, in a repo where
  migrations are dispatched by hand and two are outstanding right now. Migrate-on-read is
  incremental, reversible until the next save, and testable against real rows.
- **Store rendered output alongside the source.** Denormalises the thing whose whole promise is
  that it re-resolves against the live trip, and doubles the format problem instead of solving
  it.
