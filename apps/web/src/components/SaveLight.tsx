"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { SendFailure } from "@/components/trip/context/optimistic";
import { cn } from "@/lib/cn";

// RULES.md 1 says the top bar is account scope only, and SPEC §"The logo is
// the save light" answers the objection head-on rather than leaving it to be
// rediscovered here: "Save state is technically trip-scoped while the logo is
// account-scope; it stays there because it is *status*, not an action."
//
// The wiring problem that creates: save state is born inside TripProvider,
// which mounts *below* the header in the tree, so the logo cannot read it as
// context the ordinary way. This module is the channel — a provider mounted
// in the root layout, above both, that the trip publishes into and the mark
// reads out of. AppHeader itself stays a server component (its own comment
// explains why that matters); only the mark is a client island, the same
// shape as the account menu it sits beside.
//
// Nothing else is allowed to publish: a second writer would race the trip's
// own state and there is only one light to show it on.

export type SaveState = {
  unsent: number;
  failure: SendFailure | null;
  retry: () => void;
};

const REST: SaveState = { unsent: 0, failure: null, retry: () => {} };

type SaveLightContext = {
  state: SaveState;
  publish: (state: SaveState | null) => void;
};

const Context = createContext<SaveLightContext | null>(null);

export function SaveLightProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SaveState | null>(null);
  const publish = useCallback((next: SaveState | null) => setState(next), []);
  const value = useMemo(() => ({ state: state ?? REST, publish }), [state, publish]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

// Publish this trip's save state to the header logo for as long as the
// component calling it is mounted, and hand the light back to rest on the way
// out. Without that cleanup the mark would keep showing the last trip's
// "saving…" after you navigated away from it — the light is account-scope
// chrome, so it outlives every trip that writes to it.
export function usePublishSaveState(state: SaveState): void {
  const context = useContext(Context);
  const publish = context?.publish;
  const { unsent, failure, retry } = state;

  useEffect(() => {
    if (!publish) return;
    publish({ unsent, failure, retry });
    return () => publish(null);
    // Depending on the three fields rather than the `state` object: callers
    // build it inline (TripProvider's context value is a fresh object every
    // render), so an object-identity dependency would republish on every
    // render of every trip screen.
  }, [publish, unsent, failure, retry]);
}

export function useSaveLight(): SaveState {
  return useContext(Context)?.state ?? REST;
}

// SPEC: "One mark, two jobs. `◎` is brand at rest, breathes (1.5s opacity
// pulse, no spinner) while saving, and turns `--color-danger` when it cannot
// reach the trip."
//
// One deviation, deliberate: in the failed state the mark is a button that
// retries. The design gives the failure a colour but no way out of it, and
// RULES.md 6 asks every screen to "recover from the worst" — the retry
// affordance the old in-trip indicator carried (KI-36 shipped it precisely
// because the queue only retries when asked) would otherwise be deleted along
// with the indicator, leaving unsent work with nothing to press. It stays an
// icon-sized target with an accessible name, not new chrome, and it is a
// button *only* while there is a failure to clear.
export function SaveLightMark() {
  const { unsent, failure, retry } = useSaveLight();
  const failed = Boolean(failure);
  const saving = !failed && unsent > 0;
  const changes = `${unsent} ${unsent === 1 ? "change" : "changes"}`;

  const mark = (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-xl text-surface",
        failed ? "bg-danger" : "bg-brand",
        saving && "save-light-breathing",
      )}
    >
      ◎
    </span>
  );

  // The status text lives in a live region beside the mark rather than on it,
  // for the reason SyncIndicator recorded before it: assistive tech registers
  // a live region when it mounts, so a region that is always present and
  // changes its text announces reliably, where one that appears and
  // disappears with the state does not. It stays polite, not assertive —
  // TripBoardScreen already raises the server's own rejection in an alert,
  // and two announcements of one event talk over each other.
  // sr-only, because the design gives the mark itself the whole job of
  // showing state — there is no visible label to read any more. The name is
  // carried on `aria-label` as well as in the text: it is the same string
  // either way, and m6-optimistic/m8-make-it-real both assert the state by
  // that attribute, a contract that predates this move and still holds.
  const name = failed ? `Couldn't save — ${changes} not sent` : saving ? "Saving…" : "All changes saved";
  const status = (
    <span role="status" aria-label={name} title={name} className="sr-only">
      {name}
    </span>
  );

  if (failed) {
    return (
      <span className="flex items-center gap-2.5">
        {/* The ui Button primitive rather than a bare <button> (the
            design-system lint wall bars the latter), stripped back to the
            mark's own geometry — the same treatment TripHeader gives the trip
            title when it became the settings trigger. */}
        <Button
          variant="ghost"
          onClick={retry}
          // Named for the action, not the state: the mark's colour and the
          // status region beside it already say "couldn't save", and a
          // control's name should say what pressing it does. Same name the
          // retired SyncIndicator's Retry button carried, which m6-optimistic
          // asserts.
          title={`Retry saving ${changes}`}
          aria-label={`Retry saving ${changes}`}
          className="h-auto rounded-xl p-0 hover:bg-transparent"
        >
          {mark}
        </Button>
        {status}
        <span className="font-display text-md font-semibold text-ink">Caesura</span>
      </span>
    );
  }

  return (
    <Link href="/" className="flex items-center gap-2.5 no-underline">
      {mark}
      {status}
      <span className="font-display text-md font-semibold text-ink">Caesura</span>
    </Link>
  );
}
