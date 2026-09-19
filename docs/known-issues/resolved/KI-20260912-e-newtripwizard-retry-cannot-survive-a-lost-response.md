### KI-2026-09-12-e — `NewTripWizard`'s retry is safe against a *rejected* command but not against a *lost response*, so a committed write can still duplicate or deadlock

- **Severity:** correctness on a transient-failure path (no known reachable bug without a dropped response; needs a real network fault, not a domain rejection). Bounded to trip creation.
- **Area:** `apps/web/src/components/home/NewTripWizard.tsx` — the `progress` latch (`tripId`/`datedAs`/`budgetAppliedAs`/`currencyAppliedAs`) and the create → dates → budget → currency sequence; `apps/web/src/lib/apiClient.ts` (`createTrip`, `dispatch`) which turn any failure, transport or domain, into the same `ok: false`.
- **What is wrong, in two shapes, both raised by Copilot on PR #165:**
  1. **Create.** If `CreateTrip` commits on the server but the browser loses the response, `createTrip` returns `ok: false`, so `progress` never receives the server-minted `tripId`. Retrying re-POSTs `CreateTrip` and makes a **second trip**. The latch only suppresses duplicates *after* a successful response.
  2. **Post-create commands.** Same shape for `SetTripDates`/`SetTripBudget`/`SetTripCurrency`: the server can commit and the fetch still fail, leaving the latch unchanged. The retry then sends the identical value, the domain rejects it as `no-op`, and the wizard reports that rejection as the failure — the exact dead end `KI-2026-09-08-a` closed, reachable again through a different door.
- **Why it was not fixed on PR #165.** That PR closed the *rejection* case: it stopped re-sending a value the client knows landed, and (on review) started sending clearing commands when a field is emptied. Both are decidable from client state. The lost-response case is not: the client cannot tell "committed but unheard" from "never committed" without either a **client-supplied idempotency key** (a client-minted `tripId`, so a replayed `CreateTrip` is the same trip) or **reconciling against server state before retrying**. Either is a command-pipeline design decision with reach well beyond this wizard — every command path has the same exposure — so it belongs in its own change with Mitchell's call on which, not bolted onto a backlog-cleanup PR.
- **Scope:** decide between an idempotency key on the command envelope and a read-back reconcile; if the key, it is a `packages/contracts` change and therefore its own reviewed PR under AGENTS.md invariant #5, with a `docs/contracts/CHANGELOG.md` entry.
- **Cross-reference:** `KI-2026-09-08-a` (the rejection half, resolved); PR #165 review threads from `copilot-pull-request-reviewer` on `NewTripWizard.tsx:205-212` and `:231-238`.
- **First noted:** 2026-09-12, from Copilot's review of PR #165.

---

**RESOLVED 2026-09-16** — the create half, with an idempotency key.

**D-D, Mitchell's call**: the key, not a read-back reconcile. Read-back costs a
round trip on every retry and needs a list-and-match heuristic on a name that is
not unique, so it pays a permanent cost to handle a transient fault.

What changed, and three corrections to this entry's own scope line, all
grep-verified against the files rather than remembered:

1. **Not a `packages/contracts` change, so not its own reviewed PR.**
   `CreateTrip` has always carried `tripId` (`packages/contracts/src/trip.ts`).
   What minted it was `randomUUID()` inside the route, and what forbade a caller
   from supplying one was `CreateTripBody` — a route-local zod schema in
   `apps/web`. AGENTS.md invariant 5 was never engaged.
2. **The server already distinguished the case.** `decideCreateTrip` answers
   `reject("trip-already-exists", …)`, and `POST /api/trips/:id/commands` was
   already returning `code` on the wire. Only `POST /api/trips` threw it away.
3. **So the whole create-half gap was that asymmetry.** The route now returns
   `code`, `createTrip` surfaces it, and `createTripWithSetup` mints the id and
   reads `trip-already-exists` as *landed* rather than as a failure.

The retry-latch logic moved out of the component to `newTripSubmit.ts` in the
same slice — the four-turn script has no budget or currency turn, and the tests
that guarded this behaviour drove it through those fields. Fourteen tests there
now, including four for this entry specifically: the id is sent, the id we
minted (not the server's echo) is the one latched, `trip-already-exists` is
success, and a create that really failed still reports.

**The dates half of shape 2 is unchanged and was never the defect here** — it is
KI-2026-09-08-a's latch, which already covered it and still does.
