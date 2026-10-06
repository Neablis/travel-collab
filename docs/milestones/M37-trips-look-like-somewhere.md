# M37 — A trip looks like somewhere before it has a plan

**Status:** **Proposed 2026-10-06, placed after M35. Not scoped yet**: the decisions below are
recommendations and none has been answered. Minted from `docs/candidates.md` when its 42 unplaced
entries were grouped into milestones (asked 2026-10-06: *"Go through the suggested new features,
categorize them into similar features, and lets build out our next new milestones"*). The grouping
and the order are in `docs/milestones/README.md` under *2026-10-06 — proposed: M37 to M47*.

## Why this exists

The home page is the first screen after sign-in, and a new trip looks empty on it. Mitchell,
2026-10-04: *"better card for trips on your homepage, especially when a trip doesn't have days or
activities, it looks very blank atm"*. The same day he asked for *"leveraging unsplashed free photos
to add photos to activities, trips, playbook days notebooks"*. A cover photo carries most of the
visual weight a card needs, but the card must still work without one. That is why both are one
milestone. The card also still leaves out the trip's length, which a 2026-08-01 entry asked for.

Candidates absorbed (each deleted by this gate):
- *Better home-page trip cards, above all for a trip with no days or stops* (2026-10-04)
- *Free Unsplash photos on activities, trips, playbook days and notebooks* (2026-10-04)
- *Trip list row: show the trip's length* (2026-08-01)

## Decisions it needs (recommendations; none answered)

1. **A photo is a decoration on the trip, not a plan fact.** *Recommended:* store it as trip
   metadata (a column or side table: Unsplash id, URLs, photographer, credit link), not as an
   event. Changing a cover is not something History needs to undo, and keeping it out of the log
   keeps invariant 1 simple. The other option, an event, gives undo and replay but puts a vendor
   URL into payloads that are replayed forever.
2. **Fetch once, store the choice, never query per view.** The Unsplash key is server-side only
   (ADR-052: external data enters as a server-fetched input). The demo tier is rate-limited, so
   a search runs only when someone is choosing a photo. Unsplash's terms require the credit line
   and a download-tracking ping when a photo is picked.
3. **Hotlink Unsplash's CDN, do not copy the file.** *Recommended:* Unsplash's guidelines expect
   hotlinking, and copying means storage we do not have.
4. **Scope of the first pass: trips, then playbook days.** *Recommended:* stops and notebooks get
   photos in a later pass. A stop photo is per-stop UI on the board, which is a design question.
   Public playbook days need a decision on their OG images (ADR-061).
5. **The card reads only what the trip list already returns.** Any new fact the card shows
   (route, stop count, travellers, cost per person) is added to `TripSummary` in one read. It is
   never fetched per card. That is a contracts change with a changelog entry.
6. **Default cover.** *Recommended:* none chosen automatically. The empty card gets a designed
   state instead: dates or destination if known, a prompt to add the first day, and an invite
   nudge when the owner is alone. An automatic search on the destination name is the
   alternative. It costs one API call per new trip and sometimes picks the wrong place.

## Scope

- `components/home/TripCard.tsx`: a designed empty state and a fuller populated card. Its
  skeleton in `HomeSkeletons.tsx` changes to match. This is a design change, so it goes through
  the design sync first if it touches `.design-sync/**`.
- A server route that searches Unsplash, and a picker in trip settings that sets and clears a
  cover. Each pick stores the credit and pings Unsplash's download endpoint.
- The trip's length in days on the card.
- Covers on public playbook days, if decision 4 keeps them in this milestone.

## Out of scope

- Uploading your own photo, which needs storage and moderation.
- Photos on individual stops and notebooks, unless decision 4 is answered the other way.
- The demo-trip picker on the front door (M42).

## Exit gate

- [ ] **Decisions 1–6 are answered and recorded here**, with the date and who answered.
- [ ] **An empty trip's card is designed, not blank**: a trip with no days and no stops shows its
      dates or destination and a next step, and a test asserts that state. The test was seen red
      against the old card.
- [ ] **A cover can be searched, picked and cleared**, with the photographer's credit visible
      wherever the photo renders. The download ping fires once per pick, which an integration test
      asserts against a stubbed Unsplash.
- [ ] **No page view calls Unsplash.** An integration test, or a grep wall, shows the card and trip
      routes read the stored URL only.
- [ ] **The card shows the trip's length**, and `TripSummary` changes appear in
      `docs/contracts/CHANGELOG.md`.
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: create an empty trip, see
      the designed card, pick a cover, and see it on the card.
- [ ] **[walk]** On the PR preview, the home page with one empty and one populated trip is walked
      at desktop and phone widths.
- [ ] A retro is appended at gate close.
