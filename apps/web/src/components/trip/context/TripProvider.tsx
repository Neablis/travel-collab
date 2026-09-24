"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { BatchableCommand, TripDetail, TripHistory, TripRole } from "@tc/contracts";
import { usePublishSaveState } from "@/components/SaveLight";
import {
  fetchTripAccess,
  fetchTripDetail,
  fetchTripDetailAt,
  fetchTripHistory,
  sendTripCommand,
  sendTripCommandBatch,
  type BoardCommand,
  type CommandOutcome,
} from "@/lib/apiClient";
import { cachedRead, invalidate } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import {
  activeDetail,
  activeHistory,
  clearFailure,
  confirmHead,
  adoptOutcome,
  enqueue,
  failHead,
  unsentCount,
  type OptimisticState,
  type SendFailure,
} from "./optimistic";
import { isDemoTripId } from "@/lib/demoTrip";
import { headSeqOf, useTripBroadcast } from "./broadcast";

type Status = "loading" | "ready" | "unauthenticated" | "error";
type TripCtx = {
  // The trip this provider is for. Exposed because several controls need it
  // to talk to an endpoint rather than to read state — `trip` is null while
  // loading and during an error, and those controls still know which trip
  // they belong to (M11 link 6's AddSavedDayButton is the first).
  tripId: string;
  trip: TripDetail | null;
  history: TripHistory | null;
  activeTrip: TripDetail | null;
  status: Status;
  error: string | null;
  pending: boolean;
  dispatch: (command: BoardCommand) => Promise<void>;
  dispatchBatch: (commands: BatchableCommand[]) => Promise<void>;
  // Replace confirmed state with an authoritative outcome the client didn't
  // predict — the AI planning batch is decided server-side, so the client
  // never held those commands to optimistically predict from. The AI response
  // already carries the resulting detail + history, so we reconcile directly
  // from it (no refetch round-trip) — same shape as how undo/redo/revert
  // reconcile from their command response below.
  applyOutcome: (outcome: CommandOutcome) => void;
  // The signed-in user's role on this trip (M11 link 3), or null while it is
  // still loading or the read failed. ADVISORY ONLY: the server refuses every
  // write from a viewer regardless (accessPolicy.ts + pages-guard.ts), and
  // this exists so the board can say "Viewer" instead of letting someone
  // drag a card and watch it snap back with a 403.
  myRole: TripRole | null;
  readOnly: boolean;
  // True once the access read has completed and FAILED — not while it is still
  // in flight. See `load()` for why the failure stays non-fatal, and TripHeader
  // for where it is said out loud.
  accessUnknown: boolean;
  // KI-36: the send queue's honest failure surface. `unsent` is the live count
  // of queued units the server has NOT accepted (retained, not discarded);
  // `failure` carries when the send failed and what the server said; `retry`
  // is the only thing that resumes sending. Retry is manual by design — there
  // is no timer, no backoff, and nothing re-sends on its own.
  sync: { unsent: number; failure: SendFailure | null; retry: () => void };
  preview: { seq: number | null; enter: (seq: number) => Promise<void>; exit: () => void };
  /**
   * Bumped every time the poll reports the trip's log moved.
   *
   * **For the parts of a trip this provider does NOT hold.** `trip` and
   * `history` are refetched by `onRemoteChange` itself, so anything reading
   * those re-renders without help. Notebook pages are the exception: they live
   * in their own table and their own reads (`OverviewLens`, `PageScreen`), and
   * since notebook edits became events they move `headSeq` like anything else.
   * A counter is the smallest thing that lets those readers notice.
   *
   * A NUMBER rather than a boolean or a timestamp: an effect keyed on it fires
   * once per change and never on a re-render, which neither of the others
   * gives you. Callers use it as a dependency, not a value — its magnitude
   * means nothing.
   */
  remoteRevision: number;
};

const Ctx = createContext<TripCtx | null>(null);
export const useTrip = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTrip outside TripProvider");
  return v;
};

// History commands (undo/redo/revert) are NOT optimistically predicted — they
// depend on the full event log, which the client does not hold. They're sent
// directly and reconciled from the authoritative response, and refuse to run
// while anything is pending (don't interleave with unconfirmed optimistic edits).
const HISTORY_TYPES = new Set(["UndoLastChange", "RedoChange", "RevertToState"]);

export function TripProvider({ tripId, children }: { tripId: string; children: React.ReactNode }) {
  const [optimistic, setOptimistic] = useState<OptimisticState | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<TripRole | null>(null);
  const [accessUnknown, setAccessUnknown] = useState(false);
  // See `remoteRevision` on the context type for why this is a counter.
  const [remoteRevision, setRemoteRevision] = useState(0);
  const [previewSeq, setPreviewSeq] = useState<number | null>(null);
  const [previewTrip, setPreviewTrip] = useState<TripDetail | null>(null);
  const seq = useRef(0);
  // Mirrors `optimistic` so `runDispatch` can predict against the CURRENT queue
  // without taking it as a dependency. Two things depend on that: the callback
  // keeps a stable identity (a drag captures it once and must not see it swap
  // mid-gesture), and a second dispatch in the same tick chains off the first
  // instead of re-reading a render-old value. Both broke the unscheduled-rack
  // drag when this was written as a plain dependency.
  const optimisticRef = useRef<OptimisticState | null>(null);

  const load = useCallback(async () => {
    try {
      const [detailResult, historyResult, accessResult] = await Promise.all([
        // Read through the cache (ADR-046). These three fire on every MOUNT of
        // this provider, which is every arrival at the trip route — so home →
        // trip → home → trip paid for six reads of documents that had not
        // moved, and the first of them duplicated the `TripDetail` the home
        // page's hero had just fetched for its stats.
        //
        // `DEDUPE.NAVIGATION` (5s) and not longer, deliberately. This used
        // to say "with no polling and no socket anywhere in this app,
        // remounting IS how you find out a co-traveller edited the trip" —
        // true when ADR-046 wrote it, and **no longer true since M13 link 2**:
        // `useTripBroadcast` below polls this trip's log and refetches when it
        // moves. The window is still sized to one navigation round trip, and
        // every command invalidates it (`sendTripCommand`'s `finally`), so it
        // can only ever hide a REMOTE write, never one of yours — and the
        // broadcast refetch invalidates before it reads, so the poll is never
        // answered out of the cache it exists to bypass.
        cachedRead(tripKeys.detail(tripId), () => fetchTripDetail(tripId)),
        cachedRead(tripKeys.history(tripId), () => fetchTripHistory(tripId)),
        // Failure here is deliberately non-fatal: `myRole` stays null and the
        // board behaves exactly as it did before roles existed. The server is
        // the boundary; this read only decides what the UI *offers*.
        cachedRead(tripKeys.access(tripId), () => fetchTripAccess(tripId)),
      ]);
      setMyRole(accessResult.ok ? accessResult.value.myRole : null);
      // Reviewed and kept non-fatal, deliberately, against the alternative
      // (docs/reviews/2026-08-28-m11-pr71-review.md §5's PLAUSIBLE edge): a
      // failed access read for a real VIEWER leaves the board live, and every
      // write they then attempt 403s into a retained queue whose retry can
      // never succeed. Treating an unknown role as read-only would fix that
      // case and break the commoner one — an OWNER locked out of their own
      // trip by one 500 on a secondary read, with no way back but a reload.
      // A false "view only" is the worse failure, and it would be the more
      // frequent one, so the failure is surfaced rather than acted on:
      // `accessUnknown` is what TripHeader says out loud, so a later refusal
      // is expected rather than mystifying. The security boundary is
      // unchanged either way — the server refuses every write independently
      // (accessPolicy.ts), and it is the only thing that ever did.
      setAccessUnknown(!accessResult.ok);
      if (!detailResult.ok) {
        setStatus(detailResult.error.status === 401 ? "unauthenticated" : "error");
        setError(detailResult.error.message);
        return;
      }
      setOptimistic({
        confirmed: {
          detail: detailResult.value,
          history: historyResult.ok
            ? historyResult.value
            : { tripId, entries: [], canUndo: false, canRedo: false },
        },
        pending: [],
      });
      setStatus("ready");
    } catch (err) {
      // `status` has exactly one terminal-looking value that renders nothing
      // and says nothing — "loading" — so any throw that escapes here leaves
      // a permanent spinner with no error and no retry
      // (docs/reviews/2026-08-28-project-review.md §1.1, second site). The
      // apiClient helpers resolve rather than reject now, which makes this
      // unreachable through them; it is kept because the cost of being wrong
      // about that is a page that never loads and never explains itself.
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not load this trip.");
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exit = useCallback(() => {
    setPreviewSeq(null);
    setPreviewTrip(null);
  }, []);

  const pending = (optimistic?.pending.length ?? 0) > 0;

  const enter = useCallback(
    async (seqArg: number) => {
      if (pending) return; // cannot branch history preview from unconfirmed state
      const result = await fetchTripDetailAt(tripId, seqArg);
      if (result.ok) {
        setPreviewSeq(seqArg);
        setPreviewTrip(result.value);
      } else {
        setError(result.error.message);
      }
    },
    [tripId, pending],
  );

  // Sequential sender: whenever there is a pending head and nothing already in
  // flight, send the head; reconcile or roll back on its result. Only one send
  // is ever in flight — `inFlight` is a ref (not state) so re-renders that fire
  // while a send is outstanding don't kick off a second send for the same head.
  const inFlight = useRef(false);
  useEffect(() => {
    // The `failure` clause is load-bearing (KI-36): now that a failed send
    // RETAINS its queue, emptiness alone no longer stops the sender, and
    // without this the effect re-fires on the retained head and re-sends the
    // same rejected command without bound. Only `retry()` lifts the gate.
    if (!optimistic || optimistic.pending.length === 0 || optimistic.failure || inFlight.current) return;
    const head = optimistic.pending[0]!;
    inFlight.current = true;
    (async () => {
      let result: { ok: true; value: CommandOutcome } | { ok: false; error: { message: string; code?: string } };
      try {
        result =
          head.commands.length === 1
            ? await sendTripCommand(head.commands[0]! as BoardCommand)
            : await sendTripCommandBatch(tripId, head.commands);
      } catch (err) {
        // A throw here is a failed send like any other, and is treated as one
        // so the user gets KI-36's retained queue and manual retry. It should
        // be unreachable — every apiClient helper resolves rather than
        // rejects (see its module invariant) — but this is the site where
        // being wrong was catastrophic: the reset below was skipped, the
        // sender stayed gated for the life of the page, and every queued edit
        // was lost on navigation with the header still saying "Saving…"
        // (docs/reviews/2026-08-28-project-review.md §1.1).
        result = { ok: false, error: { message: err instanceof Error ? err.message : "Network error" } };
      } finally {
        // Unconditional, and the whole point of the try/finally: nothing on
        // any path may leave the sequential sender permanently in flight.
        inFlight.current = false;
      }
      // Built out here, not inside the updater below: `new Date()` is a
      // wall-clock read and updaters must stay pure (React may invoke them
      // more than once), which is the same reason setError is decided out
      // here. `failHead` takes the timestamp as a parameter and never reads a
      // clock itself, so the reducer stays testable with a fixed instant.
      const failure: SendFailure | null =
        result.ok || result.error.code === "no-op"
          ? null
          : { at: new Date().toISOString(), message: result.error.message };
      setOptimistic((prev) => {
        if (!prev) return prev;
        if (result.ok) {
          return confirmHead(prev, result.value);
        }
        // A "no-op" (e.g. re-setting a value to what it already is) changed
        // nothing — surfacing it as a page alert alarms the user for a
        // harmless action (#7HuQy). Treat it as a benign no-op: no error, and
        // the (already-applied-optimistically) head is simply confirmed away
        // against the existing confirmed state. `failure === null` on a failed
        // result means exactly this case.
        if (!failure) return confirmHead(prev, prev.confirmed);
        return failHead(prev, failure);
      });
      // Decided from `result` (already known, outer scope) rather than from
      // inside the setOptimistic updater above — updater functions must stay
      // pure, since React may invoke them more than once.
      if (result.ok) {
        setError(null);
      } else if (result.error.code !== "no-op") {
        setError(result.error.message);
      }
    })();
  }, [optimistic, tripId]);

  // A viewer holds read access and executes no planning command at all
  // (accessPolicy.ts's MINIMUM_ROLE table has no "viewer" entry). Stopping
  // here rather than at the network means the optimistic queue never predicts
  // a change that is going to be refused — which is what would otherwise make
  // a card visibly move and then jump back.
  const readOnly = myRole === "viewer";

  // Both refusals below say the same thing, but not in the same words: on the
  // demo board (`/demo`, ADR-031) the reader is a stranger who was invited to
  // poke at it, and "you have view-only access to this trip" reads as a
  // permissions problem they did something wrong to hit. It is neither — it is
  // the answer to "what would happen if I could edit this", and the honest
  // reply names the way to find out.
  const refusal = isDemoTripId(tripId)
    ? "This is an example trip, so nothing here changes. Make it yours and every part of it becomes editable."
    : "You have view-only access to this trip.";

  const runDispatch = useCallback((commands: BatchableCommand[]) => {
    if (readOnly) {
      setError(refusal);
      return;
    }
    // Predicted OUTSIDE the updater, against `optimistic` from this render.
    //
    // It used to be computed inside `setOptimistic`, assigning to a `let` that
    // the line after the call then read. React does not run an updater
    // synchronously — updaters run in the render phase — so that read always
    // saw `null` and EVERY predicted rejection was silent: no send, no
    // message, a click that did nothing. Mitchell hit this walking the #71
    // preview: a trip whose state rejects every command (a deleted one, say,
    // which `decideCommand` refuses wholesale) looked simply inert.
    //
    // The send effect above already computes its failure in the outer scope
    // for exactly this reason and says so — "updater functions must stay pure,
    // since React may invoke them more than once". This is that rule applied
    // to the path that was still breaking it.
    const base = optimisticRef.current;
    if (!base) return;
    const result = enqueue(base, `c${++seq.current}`, commands);
    if (!result.ok) {
      // A no-op changed nothing, which is not worth alarming anyone about —
      // the same judgement the send effect makes on the server's own no-op.
      setError(result.code === "no-op" ? null : result.message);
      return;
    }
    // Advanced before `setOptimistic` so anything dispatched later in this same
    // tick predicts against this result rather than the pre-dispatch queue.
    optimisticRef.current = result.state;
    setError(null);
    setOptimistic(result.state);
  }, [readOnly, refusal]);

  // ---- M13 link 2: a co-traveller's edits arrive ------------------------
  //
  // The poll says only "the trip moved"; the authoritative detail comes from
  // the server's own projection. **Deliberately a refetch and not a client-side
  // fold of the envelopes the poll returns**: `tripDetailFromState` takes a
  // ConflictContext and the server projects with `serverConflictContext()`, so
  // folding here with a different one would let `confirmed` — which is supposed
  // to BE authoritative server state — disagree with the server about which
  // conflicts exist. That is precisely the area link 4 is about, and a
  // divergence there would be invisible until it mattered. The envelopes are
  // not wasted: they are what link 4 reads to know which stop a remote edit
  // touched.
  const onRemoteChange = useCallback(() => {
    // Bumped FIRST, and outside the async body on purpose: a reader of this
    // trip's notebook pages has its own fetch to do, and making it wait for
    // this provider's detail+history round trip would add latency for no
    // reason. The two reads are independent.
    setRemoteRevision((n) => n + 1);
    void (async () => {
      // Invalidate BEFORE reading. `cachedRead`'s 5s window and the poll's 5s
      // interval are the same order of magnitude, so without this the refetch
      // triggered by a poll could be answered out of the very cache entry the
      // poll just proved stale.
      invalidate(tripKeys.all(tripId));
      const [detailResult, historyResult] = await Promise.all([
        cachedRead(tripKeys.detail(tripId), () => fetchTripDetail(tripId)),
        cachedRead(tripKeys.history(tripId), () => fetchTripHistory(tripId)),
      ]);
      // A failed refetch is silent for the same reason a failed poll is: the
      // next tick tries again, and nothing local is lost by missing one.
      if (!detailResult.ok || !historyResult.ok) return;
      // Through `adoptOutcome`, never around it (ADR-049 Decision 4). A remote
      // edit arriving mid-queue is the same problem as a local outcome arriving
      // mid-queue: adopt the authoritative state, re-predict what is queued.
      // Assigning `{ confirmed, pending: [] }` here would have made remote edits
      // a fourth member of the KI-5/KI-90 loss class link 3 just closed.
      setOptimistic((prev) =>
        prev
          ? adoptOutcome(prev, { detail: detailResult.value, history: historyResult.value })
          : prev,
      );
    })();
  }, [tripId]);

  const dispatch = useCallback(
    async (command: BoardCommand) => {
      if (readOnly) {
        setError(refusal);
        return;
      }
      if (HISTORY_TYPES.has(command.type)) {
        // The REF, not the render-time `pending` (KI-70). This used to be the
        // only thing that made the reconcile below safe; since M13 link 3 that
        // reconcile re-predicts rather than clearing, so the guard no longer
        // carries correctness — it is now a PRODUCT rule, and the one KI-90
        // declined to decide: a history command does not start while unsent
        // work is queued. Whether it should (and whether the silent `return`
        // should say so) is still open, and is a decision, not a bug.
        //
        // It used to read a value derived during render — so an undo/redo/revert
        // fired in the same tick as an accepted enqueue saw the PRE-enqueue
        // `false`, passed, and reconciled away the unit that had been queued a
        // moment earlier. One user edit gone, with no error and no count.
        //
        // `runDispatch` advances `optimisticRef.current` synchronously for
        // exactly this hazard ("anything dispatched later in this same tick
        // predicts against this result rather than the pre-dispatch queue");
        // the history branch now guards on the same value it is guarding.
        if ((optimisticRef.current?.pending.length ?? 0) > 0) return;
        setError(null);
        const result = await sendTripCommand(command);
        if (!result.ok) {
          // An undo that named its batch (an assistant card's, M27 D17) and
          // found another change on top. Nothing was appended, and the refusal
          // itself proves the log moved — so this is remote news, fetched the
          // same way a poll's is. The card that sent it derives "Changed
          // since" from the history that comes back; a banner would say the
          // same thing a second time, somewhere else.
          if (result.error.code === "undo-target-changed") {
            onRemoteChange();
            return;
          }
          if (result.error.code !== "no-op") setError(result.error.message);
          return;
        }
        // KI-90: this was `{ confirmed: result.value, pending: [] }`. The guard
        // above runs BEFORE the await, so a unit enqueued while the undo was in
        // flight — a window measured in network latency — was discarded here on
        // arrival. `adoptOutcome` re-predicts the queue onto the authoritative
        // result instead of clearing it, so the reconcile is non-lossy whatever
        // the queue holds by the time it lands.
        setOptimistic((prev) => (prev ? adoptOutcome(prev, result.value) : prev));
        exit();
        return;
      }
      runDispatch([command as BatchableCommand]);
    },
    // No `pending` here any more: the guard above reads the ref instead, so
    // this callback no longer has to be rebuilt on every queue change — and
    // one fewer render-time value closed over is one fewer way to read a
    // stale one.
    [runDispatch, exit, readOnly, refusal, onRemoteChange],
  );

  // KI-36: the manual retry. Clearing the failure is all it takes — the
  // sequential sender's effect re-runs on the new state and picks the retained
  // head back up. No re-enqueue, no re-prediction: the queue never left.
  const retry = useCallback(() => {
    setError(null);
    setOptimistic((prev) => (prev ? clearFailure(prev) : prev));
  }, []);

  const dispatchBatch = useCallback(
    async (commands: BatchableCommand[]) => {
      runDispatch(commands);
    },
    [runDispatch],
  );

  const applyOutcome = useCallback((outcome: CommandOutcome) => {
    // `outcome` is `{ detail, history }` — exactly the `confirmed` shape.
    //
    // This used to clear `pending` and carry a PRECONDITION on the caller:
    // only apply an outcome when the queue is empty, because the server decided
    // this outcome without seeing anything still queued here. That precondition
    // was unenforceable — it lived in this comment, and a third caller would
    // have inherited it by reading it — and it is KI-5's ledger row of the same
    // name. `adoptOutcome` re-predicts the queue onto the outcome instead, so
    // an ungated caller no longer costs the user their unsent work.
    //
    // The existing callers still gate their own affordance, and should: being
    // TOLD why a control is unavailable beats watching it silently do something
    // subtler than expected. AddSavedDayButton disables the button and
    // TripBoardScreen's assistant ask reports it in the rail
    // (docs/reviews/2026-08-28-m11-pr71-review.md §4). That is now a UX choice
    // rather than the only thing standing between a caller and data loss.
    setOptimistic((prev) => (prev ? adoptOutcome(prev, outcome) : prev));
    setError(null);
  }, []);

  useTripBroadcast({
    tripId,
    // While the board is previewing an older seq, the present moving underneath
    // it is noise rather than news. The demo trip is refused inside the hook.
    enabled: status === "ready" && previewSeq === null,
    // A solo trip has no second writer, so a TIMER would be pure cost — but the
    // same person in a second tab is a writer, and coming back to this one
    // still asks once (ADR-049 Decision 2).
    interval: (optimistic?.confirmed.detail.members.length ?? 0) > 1,
    // Read at poll time, not captured: the confirmed head advances every time
    // the user's own work lands, and a stale cursor would re-report those as
    // remote news on every tick.
    cursor: () => (optimisticRef.current ? headSeqOf(optimisticRef.current.confirmed.history) : 0),
    onChanged: onRemoteChange,
  });

  // Kept in step with the state on every render, so a change made anywhere
  // else — the initial load, the sender confirming a head, applyOutcome,
  // retry — is what the next dispatch predicts against.
  optimisticRef.current = optimistic;

  const confirmedDetail = optimistic ? activeDetail(optimistic) : null;
  const history: TripHistory | null = optimistic ? activeHistory(optimistic) : null;
  const trip = optimistic?.confirmed.detail ?? null;
  const activeTrip = previewSeq !== null && previewTrip !== null ? previewTrip : confirmedDetail;

  // One object for the context and for the header's save light, so the two
  // can never disagree about whether there is unsent work.
  const sync = useMemo(
    () => ({ unsent: optimistic ? unsentCount(optimistic) : 0, failure: optimistic?.failure ?? null, retry }),
    [optimistic, retry],
  );

  return (
    <Ctx.Provider
      value={{
        tripId,
        trip,
        history,
        activeTrip,
        status,
        error,
        pending,
        dispatch,
        dispatchBatch,
        applyOutcome,
        myRole,
        readOnly,
        accessUnknown,
        sync,
        preview: { seq: previewSeq, enter, exit },
        remoteRevision,
      }}
    >
      {/* The header logo is the save light (SPEC "The logo is the save
          light"), and it renders above this provider, so the state has to be
          published upward rather than read down. Done here rather than in
          TripHeader because it is the provider that owns the value — and
          because TripHeader returns early while the trip is loading, which is
          exactly when "saving…" matters. */}
      <PublishSaveState sync={sync} />
      {children}
    </Ctx.Provider>
  );
}

// A component rather than a bare `usePublishSaveState(sync)` call inside
// TripProvider: the hook subscribes to the SaveLight context, and calling it
// in the provider body would re-render the whole trip tree whenever the light
// changed. As a leaf with no children, it re-renders alone.
function PublishSaveState({ sync }: { sync: { unsent: number; failure: SendFailure | null; retry: () => void } }) {
  usePublishSaveState(sync);
  return null;
}
