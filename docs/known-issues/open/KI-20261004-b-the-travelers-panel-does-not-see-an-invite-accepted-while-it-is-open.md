### KI-2026-10-04-b — the Travelers panel does not see an invite accepted while it is open

- **Severity:** cosmetic (stale list). Nothing is wrong on the server, and the
  rest of the page is current. Only the panel's own list is out of date until
  it is reopened.
- **Area:** `apps/web/src/components/trip/TravelersPanel.tsx` (reads
  `fetchTripAccess` once, in the effect at ~line 69, and again only after its
  own invite and revoke actions).
- **Symptom / What happens:**
  1. The owner opens Trip settings → Travelers and creates an invite. The panel
     lists it as "Waiting".
  2. Someone accepts it from another browser.
  3. The open panel still lists only the old members, with the invite still
     "Waiting".

  Closing and reopening the panel, or reloading, shows the new member and drops
  the invite. Meanwhile the trip page itself is polling and already shows the
  new member's work (for a suggester, their suggestions).
- **Why:** accepting an invite writes no trip event, and the panel does not
  listen to the page's poll, so nothing tells it to read the members again.
- **Not new:** this predates the suggester role. It is the same for editor and
  viewer invites.
- **Fix, when wanted:** re-read access while the panel is open. Either re-read
  on the trip provider's poll ticks (ADR-049), or on a slow timer only while
  the panel is mounted and has an invite out.
- **Why not fixed now:** Mitchell, 2026-10-04: "you can leave the stale issue,
  just record it for now".
- **First noted:** 2026-10-04, in the browser walk of #314's preview.
