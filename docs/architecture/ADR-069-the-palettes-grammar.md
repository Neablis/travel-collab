# ADR-069: The palette's grammar — every command is Action › Type › Target

**Status:** **Accepted — 2026-10-10.** Mitchell, in session on PR 398.
**Deciders:** Mitchell (product); Claude — drafted
Related: **ADR-068** (the palette runs the page's own actions — it stands, and this extends it),
**ADR-013** (one batch is one History entry), **RULES.md 5** (*few things, made easy*), milestone
`docs/milestones/M41-planning-without-friction.md` (D9).

## Context

ADR-068 settled *what* a ⌘K command may do: call the function the page's own control calls. It
said nothing about how the commands are named or found, and v1 grew the obvious way: a flat list
of labels — *Calendar*, *New stop*, *Trip settings*, *Move Rome to Day 2* — each with a bag of
keywords, ranked by how well the typed text fit a label or a keyword. Two things went wrong with
that as soon as the list grew past a dozen.

- **Names were invented one at a time.** *New stop* but *Share*; *Move Rome to Day 2* as a
  sentence; Account answering to "settings" until the review made labels outrank keywords. Every
  new command needed a fresh judgement about its wording and its keywords, and the judgements did
  not agree with each other.
- **A flat list does not scale to what a trip offers.** Moving any stop to any day is stops × days
  rows. Typing narrows it, but an empty palette has nothing useful to show and no way to browse.

Mitchell's direction on 2026-10-10 was a grammar: a short closed vocabulary of verbs and kinds,
so every command reads the same way, the empty palette is a menu you can walk, and typing works
from anywhere without walking it.

## Decision

1. **Every command is a path: Action › Type › Target [› Destination].**
   - Actions, a closed set: **Go to · Add · Edit · Move · Remove.**
   - Types: **Trip · Day · Stop · View · Notebook · Page.** (Notebook added 2026-10-12, M45 D4 and
     ADR-072 §2.)
   - Target: the specific thing — a trip's name, "Day 5", a stop's title, "Calendar", "Playbooks".
   - Destination: only for Move — "Move › Stop › Ramen › Day 3", "… › Unscheduled", "… › New day
     after Day N" where a drag allows it.
   - The only commands with no Type or Target are the singletons **Undo, Redo, Ask the assistant**.
   - The UI word is **Stop**; "activity" and "place" are its aliases.
   - **Copy / Duplicate are not in v1.**
   - **Nothing that destroys a whole trip is in the palette** (Remove › Trip and the like) until an
     "are you sure" step exists. Remove › Stop and Remove › Day are in: each is undoable and one
     History entry.
2. **The empty palette is a tree you drill into.**
   - Empty, it lists only the actions — each only if at least one command under it is in scope —
     and Undo, Redo and Ask when each is available.
   - Enter or Tab on a branch drills in. The input shows the path so far as a chip ("Move ›") and
     the list shows that level's children. Backspace in an empty input climbs out one level.
   - Enter on a leaf runs it, after the palette has closed and handed focus back, as before. A leaf
     calls the page's own function (ADR-068 §1).
3. **Typing matches from any level, with no drilling needed.**
   - **Every node is a candidate, branches as well as leaves** (amended 2026-10-11, Mitchell on
     PR 398): an Action, an Action › Type, Move's Action › Type › Target, and the leaves, all
     under the current level. Sometimes you know the thing and type its name, sometimes you know
     what you want to do and type the action to see its options; each is matched on its own.
   - Each word typed must match a segment, and the words must meet the segments in the path's
     order. Skipping a segment is fine; going back is not. **The last word must land on the
     node's own last segment**: a node is listed for what it is, not for its ancestors. "go" →
     the branch Go to, not the leaves under it; "trip" → the branches Go to › Trip and
     Edit › Trip, and any trip whose name matches; "tokyo" → only the Tokyo leaves; "go tokyo" →
     Go to › Trip › Tokyo; "move ramen 3" → Move › Stop › Ramen › Day 3.
   - Segments have aliases: Go to — open, view, switch; Add — new, create; Edit — change, rename;
     Remove — delete; Stop — activity, place; View — lens.
   - Each segment keeps v1's match tiers: the whole of it, its start, the start of any word in it,
     anywhere in it, its letters in order.
4. **Scope.**

   | Where | In scope |
   |---|---|
   | Anywhere signed in | Go to › Trip › *your trips*; Go to › Page › Home, Playbooks, Account; Add › Trip; Ask |
   | Signed out | Go to › Page › Playbooks |
   | Inside a trip | + this trip's Go to › View › Overview / Plan / Calendar / Map, Go to › Day › *its days*, Go to › Stop › *its stops*; Edit › Trip › Settings, People, Cover, Sharing (Sharing only when not read-only); Undo / Redo |
   | Inside a trip (not the demo trip) | + Go to › Notebook › *its notebooks*, in the Notebooks menu's order |
   | In a notebook, as someone who may edit it | Edit › Notebook › Turn editing on / Turn editing off (the toolbar's Edit page toggle) |
   | Inside a trip, as an editor, not previewing history | + Add › Stop, Add › Day; Edit › Stop › *stop* (opens the editor); Move › Stop › *stop* › *day or Unscheduled*; Move › Day › *day* › *day, or a new day after the last*; Remove › Stop › *stop*; Remove › Day › *day* |
   | Never | another trip's days or stops |

   - Go to › Day and Go to › Stop switch to Plan, scroll to the thing and focus it.
   - **Move › Day replaces the Calendar city-card commands.** Day targets are labelled with the
     cities on that day ("Day 2 · Rome"), so the city is still typeable. A move is one batch and one
     History entry, through the existing `moveDay` / `moveCommands` (ADR-068 §3).
5. **Ordering, when something is typed.**
   1. Match quality on the node's **own last segment** first (the tiers above; aliases count),
      then the **shallower** node, then match quality on the whole path. (Amended 2026-10-11:
      this was the Target's match, when only leaves were listed.)
   2. Then **nearness**: the focused stop or day, then the selected day, then the current trip,
      then everything else.
   3. Then **natural order**: days in day order, stops by day then time, trips as Home lists them.
   4. At most about eight rows, **grouped by action**.
   5. **When the top result is a branch, its children are listed straight beneath it**, nested,
      inside the same eight rows: "go" shows Go to › then Trip, Day, Stop, View, Page. Enter on
      the branch drills in; arrowing to a child and pressing Enter runs a leaf or drills a branch.

   The empty state is the action list, not a ranking. Ordering by recency is out of scope for now.

### How the engine reads this

These are implementation choices made while building the decision, recorded so the next change
does not have to rediscover them.

- **Screens register leaves, never branches.** Each command carries its whole path; the tree is
  derived from the shared prefixes (`palette/grammar.ts`), so a branch with nothing under it cannot
  exist and no screen owns a level. A Target or Destination may carry a `key` beside its label, so
  two stops both called Ramen stay two branches.
- **A command may be unlisted**: runnable by id (`runPaletteCommand`, which the assistant uses,
  ADR-072) but never a row. Only *Go to › Trip* has any, `go:trip:<tripId>:view:<View>`, landing
  on that view (ADR-072 §6) without a Destination on a Go to.
- **Nearness and natural order are metadata on the leaf** (`nearness`, `order`), supplied by the
  screen that knows them. They only break ties left by match quality; a leaf without them counts
  as global and keeps its registration order.
- **A branch's nearness and natural order are its nearest leaf's**, so it ties the way its best
  leaf would.
- **Several words may land on one segment**, in order: "go kyoto spring" reaches Kyoto in spring.
  They must all read one text of it, its label or one alias: "go view" is not Go to by its label
  and its alias "view" at once, so it reaches Go to › View.
- **The match is a table over (word, segment, text)**, not a search of every way the words can
  land, which grows combinatorially with the query and runs for every node on every keystroke
  (PR 398 review). A unit test holds it to the exhaustive search's answers.
- **An action or a singleton that matches is its own row**, under no heading, so it never splits
  its action's heading in two; a top branch's children stay with it.
- **The closed sets keep their vocabulary order** at every level (actions, then types); targets and
  destinations come nearest first, then in natural order. Drilled in, a typed query searches
  only under the chip and does not match words against the chip's own segments.

## Consequences

- Naming a new command is no longer a judgement: it is a choice of action and type from two closed
  lists plus the thing's own name. A command that fits no action is a signal to question the
  command, not to add a sixth verb — that would be a decision to record here.
- A screen registering commands now owes the palette two facts it alone knows: how near each
  command's thing is, and its natural order. Getting them wrong makes ranking worse, never
  incorrect: every match is still listed.
- The palette now offers destructive commands (Remove › Stop, Remove › Day). They are safe only
  because each is one undoable History entry; a Remove that is not must stay out until the "are you
  sure" step exists.
- v1's free keywords are gone. A word that should find a command is either an alias of the
  vocabulary (one place, every command) or part of the Target's own label.
