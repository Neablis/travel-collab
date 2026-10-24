/**
 * The live set's clock (M52 part 12): `Date` reads the real clock plus an
 * offset, set as each turn starts so the turn begins at the pinned instant.
 * Only the origin moves, so a turn's latency, step and tool durations and
 * its deadlines are measured in real milliseconds. Vitest's faked `Date`
 * (`shouldAdvanceTime`) ticked 20 ms from a real timer instead, and fell a
 * third behind under load (PR 545 review, finding 1).
 */
export interface EvalClock {
  /** Now is `at`; from here it runs at real speed. */
  startTurnAt(at: number): void;
  /** Puts the real `Date` back. */
  restore(): void;
}

/**
 * Swaps `globalThis.Date` for the offset clock and returns the handle that
 * moves its origin at each turn's start and puts the real `Date` back.
 */
export function pinClock(): EvalClock {
  const RealDate = globalThis.Date;
  let offset = 0;
  // A function rather than a subclass, so `Date()` without `new` still works.
  // It shares the real prototype, so a Date made before the swap, or by a
  // module that captured `Date`, is still `instanceof Date` to a driver or a
  // schema, and its `constructor` is the same.
  function PinnedDate(this: unknown, ...args: unknown[]): Date | string {
    if (!new.target) return new RealDate(RealDate.now() + offset).toString();
    return Reflect.construct(RealDate, args.length ? args : [RealDate.now() + offset], new.target);
  }
  Object.setPrototypeOf(PinnedDate, RealDate);
  PinnedDate.prototype = RealDate.prototype;
  PinnedDate.now = () => RealDate.now() + offset;
  Object.defineProperty(PinnedDate, "length", { value: RealDate.length });
  globalThis.Date = PinnedDate as unknown as DateConstructor;
  return {
    startTurnAt: (at) => {
      offset = at - RealDate.now();
    },
    restore: () => {
      globalThis.Date = RealDate;
    },
  };
}
