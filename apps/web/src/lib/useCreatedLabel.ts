import { useSyncExternalStore } from "react";

/** Never changes after mount, so there is nothing to subscribe to. */
const subscribeNever = () => () => {};

/**
 * A trip's "created" date as a label ("Jul 8, 2026"), or `null` when
 * `createdAt` is not a date.
 *
 * `createdAt` is an INSTANT, so which calendar day it falls on depends on the
 * zone it is read in — and Home's cards and hero render on the server (UTC)
 * as well as in the browser (the reader's zone). Formatting it in the local
 * zone during render made the two disagree near midnight, a hydration mismatch
 * that throws the server's HTML away. So the server and the hydrating render
 * both read it in UTC (the server snapshot), and React re-renders with the
 * reader's own zone straight after hydration, which is the date they have
 * always seen. A component mounted later, on the client, reads the local zone
 * from its first render.
 */
export function useCreatedLabel(createdAt: string): string | null {
  const local = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  return createdDateLabel(createdAt, local ? undefined : "UTC");
}

/** `createdAt` as "Jul 8, 2026" in `timeZone` (the process's own when omitted), or `null` when it is not a date. */
export function createdDateLabel(createdAt: string, timeZone?: string): string | null {
  const created = new Date(createdAt);
  return Number.isNaN(created.getTime())
    ? null
    : created.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });
}
