# The notebook widget framework — three shapes, four states, one ghost rule

**Written 2026-09-04.** The prose half of the framework; the gallery half is
`design/Notebook Widget Framework.dc.html`, which mounts every shape in every state with
these rules printed beside them. Companion to `SPEC.md` §18–§19 (the widget model) and to
the build's `ADR-035` / `ADR-037`.

**What this adds to the model.** ADR-037 says a widget is a module that returns typed data
and that `render` must be total. It does not say what the rendering *looks like*, so twenty
widgets could satisfy it and still disagree on borders, empty copy and what an unbound
widget shows. This is that layer: **three components, one per shape.** A widget author
picks a shape and supplies content. They never supply spacing, borders, ghost glyphs or
empty-state copy.

## The components

| Shape | Component | Takes |
|---|---|---|
| `single` | `NotebookInline.dc.html` | `parts` — a segment list |
| `block` | `NotebookBlock.dc.html` | `columns` + `rows`, optional caption and total |
| `repeat` | `NotebookRepeat.dc.html` | one authored `template` sentence + `items` |

`NotebookRepeat`'s rows **are** `NotebookInline` mounts. That is deliberate and is the
single most load-bearing decision here: there is no second chip renderer, so a chip inside
a repeated line cannot drift from a chip in prose you typed.

## The four states — every shape, same four

| State | When | Never |
|---|---|---|
| `ok` | every input bound, something to show | — |
| `ghost` | an input is unbound | never shows a real value |
| `empty` | bound, nothing matches | never says "not set up" |
| `stale` | bound to something deleted | **never falls back to another day** |

`ghost` and `empty` are different states with different copy, and conflating them is the
most common way this goes wrong: *"not set up"* tells you to act, *"Day 11 has no stops
yet"* tells you the answer is legitimately nothing.

`stale` exists because of ADR-037 decision 6's hard rule — a widget pointed at a day that
no longer exists must say so and **must not resolve to Day 1**. It names what it lost.

---

## 1. Inline — a value inside a sentence

1. **It never renders a bare string.** Even a one-word widget returns a one-segment list,
   because a string has nowhere to put a ghost. (This is ADR-037 decision 3a's `Seg[]`,
   and it is why `InlinePayload = string` had to widen.)
2. **A value chip** is brand-tinted with a 1.5px solid underline, `white-space: nowrap` so
   a value never breaks across lines, and carries the widget's name in its `title` — hover
   tells you what wrote it.
3. **A ghost** is monospace, hatched, dashed-underlined, and **shape-true**: `$XXX` for
   money, `NN` for a count, `Ddd Mmm N` for a date, `--:-- am` for a time, `———` for text
   or a city. One glyph per value kind, declared once in the component, so a new widget
   taking money gets `$XXX` for free.
4. **The words between values are the author's.** A widget never invents connective prose,
   and re-pointing it never rewrites your sentence.
5. **Ghosts are editing-only.** In reading mode an unresolved inline widget prints nothing
   — see *Reading mode* below.
6. **Stale is not a ghost.** A widget whose day was deleted says so **on the page** — danger
   ink, naming what it lost (`⚠ Day 15 — deleted`) — never in a tooltip alone. A
   mouse-only difference is no difference, and a stale widget that looks like a ghost sends
   an author to bind something that is already bound.

## 2. Block — a framed table

1. **Columns are declared, not drawn.** A `kind` per column picks its font and alignment,
   so money is mono and right-aligned in every block that holds money.
2. **A block never scrolls inside itself and never sets a fixed height.** It is as tall as
   its rows; the page scrolls, not the widget.
3. **Ghost shows the real columns, three placeholder rows, and `NN rows` in its caption.**
   Three, because "how many" is exactly what nobody has chosen yet — and the caption says
   `NN` rather than `3` so the count is never mistaken for a fact.
4. **`emptyText` is the widget's to supply and is required.** Only the widget knows why it
   is empty. The framework will not invent that sentence.
5. **A total is part of the block**, not a row: same strip, same weight, `--color-moss`
   ground, in every block that has one.
6. **Its bind row is above it**, in editing mode, one entry per widget (§19). The block
   itself carries no controls.

## 3. Repeat — one sentence, once per item

1. **Its lines are inline widgets.** No second chip renderer.
2. **The dashed rail is chrome**: it names what the widget prints over and how many, and it
   appears in editing only. In reading mode the lines are plain prose.
3. **A ghost repeat prints the sentence once**, fully ghosted. Three ghost rows would imply
   a count nobody has chosen.
4. **The authored sentence survives having nothing to print.** Whenever editing mode has no
   items — ghost, empty *or* stale — the template renders once, ghosted. The empty case is
   exactly when an author is writing the sentence, so it is the last thing that may
   disappear. In reading mode it prints nothing. (ADR-035 decision 4 says this for
   repeaters; here it is a property of the component, not of each widget.)
5. **"Edit the wording" appears only when there is wording on screen and a handler behind
   it.** A control that cannot act is worse than a missing one.
6. **Iteration values are never persisted.** What is stored is the sentence and the
   binding, never "stop #3".
7. **The rail carries the accent of the thing it repeats over when resolved**, and neutral
   grey in ghost, empty and stale. Colour means "this is real".

---

## The ghost — an empty that becomes the real thing

The rule, in one line: **a ghost is shape-true and never value-true.**

Drop a widget in and it lands as a ghost of itself, in place in the document, showing the
format of the value that is coming. Bind one input and **that part becomes real while the
rest stays ghosted** — so a half-configured widget looks half configured:

```
nothing bound   We were at ——— in ——— — $XXX.
day bound       We were at Kichi Kichi in Pontochō — $88.
day + tags      We were at Kichi Kichi in Pontochō — $88, a meal stop.
```

Five rules:

1. **Per part, not per widget.** Each part declares its value kind and which input it
   waits on, so parts resolve independently. This is what the old single "not set up" box
   could not express.
2. **A ghost is never mistakable for data.** Monospace, hatched ground, dashed underline,
   and glyphs (`XXX`, `NN`, `Ddd`) that are not values in any locale. A greyed *real* value
   would be a lie; a format is not.
3. **Never a common-sense default value.** `$XXX` is a shape. `$0` is a claim, and a wrong
   one. This is decision 6's "not common-sense defaults", kept.
4. **Structure ghosts too.** A ghost block shows its real columns; a ghost repeat shows its
   real sentence. You can see what you are about to get before you point it anywhere, which
   is what makes insert-then-bind (ADR-037 decision 4) tolerable without a modal bind step.
5. **A ghost is an invitation, not an error.** Warning ink for the one line that says what
   it needs; never danger, never an alert icon. Nothing has gone wrong — you just have not
   finished.

### Reading mode, and the one decision the build has to agree to

**Ghosts are visible in editing only.** In reading mode a widget with any unbound input
prints **nothing** — an inline one collapses, a block or repeat is skipped.

The reason: a reader of a notebook is a traveller on the trip, and showing them `$XXX` is
worse than showing them nothing. But nothing is also invisible, so anyone with edit rights
sees one quiet line at the top of the page — *"2 widgets aren't set up"* — which is theirs
alone and does not print.

This **refines ADR-037 decision 6** rather than contradicting it: the widget still renders
in every state and still never throws; "renders" in reading mode is simply "renders as
nothing". It needs the build's agreement because it is the one rule here that changes what
a resolver's output does downstream.

---

## What a widget author supplies

| | |
|---|---|
| `shape` | `inline`, `block` or `repeat`. There is no fourth shape; adding one is a framework change, not a widget. |
| `inputs` | what it takes — a day, a stretch, tags, a person, a trip. The type picks the control (§18). |
| `parts` / `columns` / `template` | inline gives a segment list; block gives columns and rows; repeat gives one sentence. **Every part declares its value kind**, which is what earns it a ghost. |
| `emptyText` | one sentence saying why a bound widget has nothing to show. Required. |
| `preview` | a fixed, generic sample for the insert rail. Never computed — or the rail and the page contradict each other in one session (§18). |

Nothing else. A widget that wants its own layout is a widget that will drift from the other
twenty.

## Still open

- **`prefers-reduced-motion`** — the ghost has no animation today, but if a fill transition
  is added it must be motion-optional.
- **The reading-mode rule above** needs the build's sign-off.
- **`stale` has no detection in the design** — it is drawn, not driven. The build knows
  when a `DayRef` no longer resolves; the design cannot demonstrate it without deleting a
  day, which the prototype does not do.
