# ADR-072: The assistant moves you around by running palette commands, and the palette can ask it

**Status:** **Accepted — 2026-10-12.** Mitchell, in session on M45's scoping.
**Deciders:** Mitchell (product); Claude — drafted
Related: **ADR-068** (one way to do each thing; the palette runs the page's actions; **§5 is
amended here**), **ADR-069** (the palette's grammar and scopes), **ADR-067** (assistant turns
write suggestions), **ADR-022** and **ADR-033** (the assistant's surfaces), **ADR-065**
(travelling), milestone `docs/milestones/M45-the-assistant-beyond-one-trip.md` (D4–D7).

## Context

M45 was proposed on 2026-10-06 with a new closed union, `ClientAction` (`openNotebook`,
`setLens`, `focusDay`, `focusStop`, `openPeople`, `setNotebookEditing`). It would hold the
replies that change client state rather than the trip: they cannot be replayed from the log, have
no `actor_id`, and cannot be undone.

M41 then built the ⌘K palette (2026-10-10). Its registry (`components/palette/paletteRegistry.ts`)
already holds most of that union as commands with stable string ids:

| Proposed `ClientAction` | Palette command |
|---|---|
| `setLens` | `view:<Overview\|Plan\|Calendar\|Map>` |
| `focusDay` | `go:day:<dayId>` |
| `focusStop` | `go:stop:<activityId>` |
| `openPeople` | `people` |
| (open a trip) | `go:trip:<tripId>` |
| `openNotebook` | — none |
| `setNotebookEditing` | — none |

A second vocabulary for the same actions is the thing ADR-068 exists to stop. Its §1 says a
command holds the page's own function and never re-implements it; a `ClientAction` handler would
be exactly that re-implementation, and the two would drift.

## Decision

1. **The assistant's client actions are palette command ids.** A reply carries the id of a
   command, never a URL and never a handler name. The client looks the id up among the commands
   the current page has registered and calls that command's `run`. The palette and the assistant
   then run one function, which ADR-068 §2's identity test covers.
2. **A missing action is added to the palette first.** *Go to › Notebook › <name>* and
   *Edit › Notebook › Turn editing on/off* become palette commands, usable by hand, before the
   assistant may name them. An action the assistant can take that a person cannot take from ⌘K is
   a defect. An *unlisted* command (runnable by id, never a row; ADR-069) does not breach this
   when it is the composition of listed commands a person can run in sequence: §6's
   trip-on-a-view ids are the only ones, and each is *Go to › Trip* followed by *Go to › View*.
3. **Which ids the assistant may name is an allowlist on the server**, by command family (`view:`,
   `go:day:`, `go:stop:`, `go:trip:`, `go:notebook:`, `people`, `notebook-editing`). Writes to the
   trip are not on it: those stay domain-command proposals and suggestions (ADR-067), with their
   own undo.
4. **Navigation runs; a change asks.** A *Go to* or view command runs when the reply arrives. A
   command that changes app state (notebook edit mode) is shown on the proposal card and runs only
   on Approve. Neither runs while the page holds unsaved input; the reply says what it would have
   done instead.
5. **An id the page does not offer does nothing.** Availability is the page's: an edit command
   that history preview or read-only access withholds from ⌘K is withheld from the assistant too.
   The reply says it could not.
6. **Crossing pages.** *Go to › Trip* may carry a view, so *"open my Kyoto trip on the map"* is one
   command, not a chain the palette has no way to run. The id is
   `go:trip:<tripId>:view:<View>` (`<View>` one of `Overview|Plan|Calendar|Map`), registered
   **unlisted** beside each listed `go:trip:<tripId>` (`palette/commands.ts`, `placeCommands`;
   ADR-069), landing on `?view=<View>`, which the trip page already reads for every view
   (`?lens=` maps only some). By hand it is the two listed commands *Go to › Trip › <name>* then
   *Go to › View › <View>* (`view:<View>`), so §2 holds. §3's `go:trip:` family covers both shapes: the server allowlist
   and the client's id filter must accept `go:trip:<tripId>` and
   `go:trip:<tripId>:view:<View>`, and nothing else under that prefix.
7. **§5 of ADR-068 is amended: the palette hands unmatched text to the assistant.** When nothing
   matches, the palette's last row is *Ask: <text>*, and choosing it opens the assistant with the
   text sent. Nothing is sent to the model until the row is chosen, so typing in ⌘K still costs
   nothing. This is offered wherever an assistant is mounted, which from M45 includes Home.

## Consequences

- No new client-state union exists, and no second dispatcher for it. Adding a destination for the
  assistant means adding a palette command, which a person gets as well.
- Client actions stay outside the event log, as the original proposal said. They are not undone
  by History; a navigation needs no undo, and edit mode is turned off the way it was turned on.
- The palette registry becomes a dependency of the assistant's client. A page that registers no
  commands gives the assistant nowhere to send you, which is the same answer ⌘K gives there.
- ADR-068 §5's reason (*"a second chat box"*) is met differently rather than dropped: the palette
  never shows a reply. It only opens the assistant's own surface.
