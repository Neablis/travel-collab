# Caesura trip planner — project rules

Binding design rules for this project. Apply them to every new screen and check
them when editing an existing one.

1. **Top bar is account scope only.** Project name / Trips / Playbooks / Avatar.
   Anything scoped to a single trip (share, quick add, trip settings, export)
   belongs inside the trip, not in the top bar.
2. **No purposeless UI.** Don't render the bottom drawer on a page where
   activities can't be dragged onto or out of the schedule. More generally: if
   an element has no purpose on this page, remove it — and challenge the user
   before adding one.
3. **Never nest dropdowns two levels deep.** No menu inside a menu, no select
   inside a popover that itself opens from a menu.
4. **Challenge to simplify.** Avoid showing the same information twice on one
   page. When asked for something that duplicates what's already there, say so
   before building it.
5. **Few things, made easy.** More options and more customization is rarely
   better. Prefer making a handful of actions genuinely easy over shipping many
   hard ones.
6. **Assume the best case, recover from the worst.** Design the happy path as
   the default view, but every screen needs a defined empty, offline/sync-fail,
   and conflict state.

---

These rules are binding on the build as well as the design. Where the build
currently disagrees, see `DRIFT.md` § "Rules pass — 2026-08-25".
