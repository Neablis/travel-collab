/**
 * **The style-load recovery ladder** — M26 link 7, Wave 1 gate.
 *
 * The failure this exists for is the silent one. `MapLens` turns a map into a
 * usable surface inside `map.on("load")`; if that event never fires, nothing
 * runs, nothing throws, and no `error` event is emitted either — the reader
 * gets a paper-coloured rectangle, forever, and so does anybody trying to
 * diagnose it. It is the reason KI-49 could say the map's tiles *"have never
 * been confirmed to paint, in any environment"*: with no ladder, a blank canvas
 * is indistinguishable from tiles-blocked, from style-never-parsed, from a
 * container measured at 0×0. After this, a blank canvas means one specific
 * thing — every rung ran and the map still did not load — and the panel says so.
 *
 * **Why a rebuild rather than a retry of the request.** MapLibre offers no
 * "load the style again" on an instance whose first attempt died; the documented
 * recovery is a new `Map`. So each rung bumps `MapLens`'s `attempt`, whose
 * effect cleanup removes the dead instance and whose body constructs a fresh
 * one into the same container.
 *
 * **Why the deadlines are absolute and not gaps.** 3.5s, 7.5s and 11s are all
 * measured from the moment the reader first asked for a map, so a rung is a
 * promise about how long they wait in total. Relative gaps would let a rebuild
 * that takes 2s of its own push the give-up point past 11s without anybody
 * changing a number.
 *
 * The numbers themselves: 3.5s is past any plausible first paint on a slow
 * connection but inside the window where somebody is still looking at the
 * screen; 7.5s gives the second instance about as long again; 11s is where
 * "still trying" stops being more useful than "here is Plan instead".
 */
export const STYLE_LOAD_LADDER_MS = [3500, 7500, 11000] as const;

/**
 * `rebuild` — throw this instance away and construct another.
 * `fall-back` — stop trying and show the offline panel, which offers Plan.
 */
export type LadderAction = "rebuild" | "fall-back";

export type LadderRung = { atMs: number; action: LadderAction };

/**
 * The ladder as data, so the schedule can be asserted without waiting 11s.
 *
 * Every rung rebuilds except the last, which gives up. That relationship is
 * derived rather than written twice: a schedule whose final entry was a rebuild
 * would leave a map retrying for as long as the reader left the tab open.
 */
export function styleLoadLadder(schedule: readonly number[] = STYLE_LOAD_LADDER_MS): LadderRung[] {
  return schedule.map((atMs, i) => ({
    atMs,
    action: i === schedule.length - 1 ? "fall-back" : "rebuild",
  }));
}

/**
 * Arm the ladder for one mount sequence. Returns the disarm.
 *
 * **Scoped to the sequence that started it**, which is the whole reason this
 * returns a function rather than reading a module-level flag: a lens that
 * unmounts, or a reader who presses *Try again*, must not leave a timer behind
 * that blanks a map belonging to somebody else's mount. Calling the returned
 * disarm is the only way a rung is ever skipped — including the ordinary case,
 * where `map.on("load")` fires and disarms every remaining rung at once.
 *
 * The timers are armed together, from the absolute deadlines, rather than
 * chained: a chain's later links would inherit any lateness of the earlier
 * ones, which is exactly the drift the absolute numbers exist to prevent.
 */
export function startStyleLoadLadder(
  onRung: (rung: LadderRung) => void,
  schedule: readonly number[] = STYLE_LOAD_LADDER_MS,
): () => void {
  let disarmed = false;
  const timers = styleLoadLadder(schedule).map((rung) =>
    setTimeout(() => {
      // Belt to the `clearTimeout` braces below: a timer that has already been
      // handed to the event loop when `disarm` runs still fires in some
      // environments, and a stale `fall-back` would blank a live map.
      if (!disarmed) onRung(rung);
    }, rung.atMs),
  );
  return () => {
    if (disarmed) return;
    disarmed = true;
    for (const timer of timers) clearTimeout(timer);
  };
}
