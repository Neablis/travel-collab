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

### AMENDED 2026-09-03: decision 4's round-trip criterion does not detect the failure decision 4 exists to prevent

Decision 4 below says, in as many words: *parse the stored document and re-serialise
it; if the result is not equivalent to what was stored, open read-only.* Building it
showed that criterion is **blind to both halves of the loss it was written for.**
Measured, in `apps/web/src/components/pages/editor/storedPageDoc.test.ts`:

- A document containing a **`repeat`** node parses cleanly and re-serialises
  **byte-identically** — `repeat` is a known type in the AST, and there is no TipTap
  extension behind it. Round-trip: pass. Editor: discards the entire document.
- A document containing a node from a **newer build** re-serialises byte-identically
  too. That is not an accident, it is exactly what **decision 3 promises**: unknown
  nodes are carried verbatim. Round-trip: pass. Editor: discards the entire document.

So the two documents the guard exists for are precisely the two it waves through.
Worse in the other direction: because known nodes re-serialise *canonically* (`v`
materialised, absent `content` filled in), a literal implementation also locks
**ordinary** pages — a stored document with no `v`, which is every document written
before this ADR, fails a strict comparison against its own re-serialisation.

The mistake is in what the criterion measures. **Round-tripping proves a document
survives OUR parser. It says nothing about the editor, and the editor is what eats
the page.** Under decision 3 it is close to a tautology by design.

**The corrected criterion, which decision 4 below now states:** a document is safe to
mount iff **every node type in it is one the editor's schema has a definition for.**
That is a vocabulary comparison across the two representations this ADR accepted the
cost of keeping in step — contracts answers "what node types are in this document"
(`collectPageDocNodeTypes`), the web app answers "what can the editor mount"
(`PAGE_EDITOR_NODE_TYPES`, derived from the live extension set via TipTap's own
`getSchema`, never a hand-written list). Parse failure is the second, separate
verdict: there is no AST, so there is nothing to render and nothing safe to write.

The **intent** of decision 4 is untouched — "a page that cannot be saved losslessly is
a page that must not be saved at all". Only the test it applies changed, and it
changed because the specified one was measured not to work.

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

**Rewritten 2026-09-03 to match what was measured and built.** The first draft of this block
listed five members and `level: 1|2|3`, both of which were wrong — see the amendment above.
Keeping the sketch would have left a reader who scrolls straight to "Decision" with the
answer that caused the problem.

```ts
type PageNode =
  // text
  | { type: "paragraph";  content: PageInlineNode[] }
  | { type: "heading";    attrs: { level: 1|2|3|4|5|6 }; content: PageInlineNode[] }
  // widgets — the discriminator is "macro", NOT "widget": it is what every stored
  // page already uses, and v1 is defined as what is already stored. Renaming it is
  // a v2 migration (see the deviation note above).
  | { type: "macro";      attrs: { name: string; params: Record<string, unknown> } }
  | { type: "repeat";     attrs: { name: string; params: Record<string, unknown> };
                          content: PageInlineNode[] }   // content IS the row template
  // the rest of StarterKit, which PageEditor loads today
  | { type: "blockquote"; content: PageNode[] }                    // recursive
  | { type: "bulletList";  content: PageListItemNode[] }
  | { type: "orderedList"; attrs: { start: number; type: string | null };
                           content: PageListItemNode[] }
  | { type: "codeBlock";  attrs: { language: string | null }; content: PageCodeTextNode[] }
  | { type: "horizontalRule" }                                     // no attrs key at all
  | { type: "unknown";    raw: unknown };                          // decision 3

type PageInlineNode =
  | { type: "text"; text: string; marks?: PageMark[] }
  | { type: "macro"; … }
  | { type: "hardBreak" }            // INLINE, not block — measured
  | { type: "unknown"; raw: unknown };
```

Every attr here is **measured from `editor.getJSON()` and `editor.schema.nodes`** using
`PageEditor`'s own extension set, not read off TipTap's docs. Three of them would have been
wrong otherwise: `orderedList` carries **`type` as well as `start`** (the `<ol type>` marker,
`null` when unset); `horizontalRule` and `hardBreak` have **no `attrs` key at all**, so
requiring one would have failed every real document; and `codeBlock`'s content is text with
`marks: ""` — ProseMirror for "no marks here" — so a bold run inside a code block is not
something the editor can even write.

`listItem` deliberately has **no group** in ProseMirror, so it is valid inside a list and
nowhere else. The AST says the same: a `listItem` at block position is a parse error.

`orderedList.attrs` and `codeBlock.attrs` carry `.default()` rather than being required.
TipTap always writes them, the defaults are TipTap's own, and defaulting removes a class of
false read-only pages. `heading.attrs.level` stays required — it carries meaning and has no
defensible default.

**Not enforced, deliberately:** ProseMirror's full content expressions, e.g. `listItem`'s
`paragraph block*` first-child rule. Child ordering is something the editor repairs on load;
rejecting it would produce a read-only page for a defect that costs nothing.

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

### 4. A document the editor cannot mount is never mounted, and never autosaved over

The rule that actually prevents the loss described above. **Rewritten 2026-09-03** — the
first draft made this a round-trip comparison, which was measured not to detect either
form of the failure; see the amendment above. The rule, not the mechanism, is what
mattered, and the rule is unchanged.

**Before the editor is mounted, parse the stored document and compare its node vocabulary
against the editor's schema. Three verdicts:**

- **mountable** — it parses, and every node type in it is one the editor's schema knows.
  Mount it, and autosave normally.
- **unsupported** — it parses, but contains node types this build's editor has no
  definition for. Open **read-only**: render the parsed document without TipTap (decision
  3's placeholder for the nodes we cannot draw), say so visibly, and disable autosave and
  every other write path on the page, the AI compose panel included.
- **unreadable** — it does not parse at all (a malformed known node, or a `v` from the
  future). There is no AST, so there is nothing to render and nothing safe to write:
  the explanation stands alone.

**The refusal must be upstream of mounting, not a flag on a mounted editor.** By the time
TipTap has fallen back to an empty document the content is gone from memory, and the
`contentError` event is a notification rather than a veto.

The write path is the same rule pointed outwards: `Create`/`UpdatePageInput` are `PageDoc`,
so a document this build cannot parse is refused at the API boundary, and the client parses
`getJSON()` before sending — a save that will not parse is not attempted, and the user is
told rather than retried at.

`Page.content` on the **read** path deliberately stays permissive. A strict read schema
would make fetching an unreadable page throw, and then there is no page to explain — you
cannot show someone a read-only notebook you refused to deliver.

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
