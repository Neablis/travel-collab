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

export function pinClock(): EvalClock {
  const RealDate = globalThis.Date;
  let offset = 0;
  class PinnedDate extends RealDate {
    constructor(...args: ConstructorParameters<DateConstructor> | []) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as ConstructorParameters<DateConstructor>));
    }
    static override now(): number {
      return RealDate.now() + offset;
    }
    // A Date made before the swap, or by another module's captured `Date`,
    // is still a Date to a driver's or a schema's `instanceof Date`.
    static [Symbol.hasInstance](value: unknown): boolean {
      return value instanceof RealDate;
    }
  }
  globalThis.Date = PinnedDate as DateConstructor;
  return {
    startTurnAt: (at) => {
      offset = at - RealDate.now();
    },
    restore: () => {
      globalThis.Date = RealDate;
    },
  };
}
