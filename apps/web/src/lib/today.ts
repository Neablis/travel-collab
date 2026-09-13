"use client";
import { useState } from "react";

/**
 * Today, as the reader's own calendar sees it — `yyyy-mm-dd`.
 *
 * **Local, not UTC, and that is the whole reason this exists beside
 * `seedDate.ts`'s `isoDateInDays`.** That one builds its answer through
 * `toISOString()`, which is a UTC date: for a reader in UTC−7 it says tomorrow
 * from 17:00 local onwards. That is harmless for dating the demo fixture ten
 * days out, and it is not harmless for a countdown, where being one day off is
 * the difference between right and wrong rather than a rounding.
 *
 * `now` is a parameter so this is testable on any date rather than only on the
 * day the suite happens to run — the same discipline Invariant 4 states for the
 * domain ("time is passed in"), applied at the one place a clock is actually
 * read.
 */
export function localTodayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The reader's calendar date, read once per mount.
 *
 * **Read on the client, and only on the client.** A notebook's widgets never
 * render on the server — `PageEditor` mounts TipTap with
 * `immediatelyRender: false`, so there is no server HTML for a date to
 * disagree with — which is what makes a plain read safe here where it would
 * otherwise be a hydration mismatch for several hours every evening west of
 * Greenwich.
 *
 * A `useState` initialiser rather than a value computed on each render: two
 * widgets on one page must not be able to straddle midnight and disagree about
 * what day it is. The cost is that a tab left open overnight counts down from
 * yesterday, which is the right trade for a page nobody watches for hours.
 */
export function useToday(): string {
  const [today] = useState(() => localTodayIso());
  return today;
}
