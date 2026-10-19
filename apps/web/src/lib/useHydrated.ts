import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * `false` on the server and through hydration, `true` after it — and `true`
 * from the first render of anything mounted later (a client-side navigation),
 * since only a hydrating render reads the server snapshot.
 *
 * For server HTML that must not pretend to be live: the trip board renders on
 * the server with its data (PR 486), and until hydration its controls are
 * drawn but answer nothing (`TripBoardScreen`).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
