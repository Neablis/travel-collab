"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TripAccess, TripMemberProfile } from "@tc/contracts";
import { useOptionalTrip } from "@/components/trip/context/TripProvider";
import { fetchTripAccess } from "@/lib/apiClient";
import { cachedRead, invalidate } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import { displayNameFor } from "@/lib/displayName";

// What a notebook widget calls each member (`WidgetContext.people`, M19 part 2).
//
// **Not a new read.** The names are the People section's own join —
// `TripAccess.members`, which `PageScreen` and `TripProvider` already fetch
// under `tripKeys.access` — so the provider below asks the cache for the
// response those surfaces share, and `displayNameFor` is the one rule that
// turns a member into a name.
//
// **Never an email.** `displayNameFor` falls back to one, and a notebook is a
// shared document that a collaborator reads: the invite landing resolves names
// the same way, with `email: null`, and `attribute`'s `account.name` states the
// rule for a page. A member with no name reads as their handle instead.

/**
 * What a person surface draws for one member (M38): the name to print, the
 * avatar they chose, and the colour this trip shows them in — already
 * clash-resolved by the server (D3), so a chip renders it as given.
 */
export type Persona = { name: string } & Pick<TripMemberProfile, "avatar" | "color" | "colorShifted">;

/** userId → their persona, for every member `TripAccess` lists. */
export function personasOf(members: readonly TripMemberProfile[]): Readonly<Record<string, Persona>> {
  return Object.fromEntries(
    members.map((m) => [
      m.userId,
      {
        name: displayNameFor({ userId: m.userId, displayName: m.displayName, name: m.name, email: null }),
        avatar: m.avatar,
        color: m.color,
        colorShifted: m.colorShifted,
      },
    ]),
  );
}

/** userId → what to call them, for every member `TripAccess` lists. */
export function peopleNamesOf(members: readonly TripMemberProfile[]): Readonly<Record<string, string>> {
  return namesOf(personasOf(members));
}

function namesOf(personas: Readonly<Record<string, Persona>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(personas).map(([userId, p]) => [userId, p.name]));
}

type People = {
  names: Readonly<Record<string, string>> | null;
  /** The same members as `names`, with what a chip draws for each (M38). */
  personas: Readonly<Record<string, Persona>> | null;
  /** Ids a fresh read was made for, and answered: one still missing has left. */
  rechecked: ReadonlySet<string>;
  /** Read the members again, once per id, for one the names do not hold. */
  recheck: (userId: string) => void;
};

const NO_ONE: ReadonlySet<string> = new Set();
const PeopleContext = createContext<People>({ names: null, personas: null, rechecked: NO_ONE, recheck: () => {} });

/**
 * The newer of two access reads, by `accessRev`; `held` on a tie or when
 * either carries none. The rev is a per-trip counter (`TripAccess.accessRev`).
 */
function newerAccess(held: TripAccess | null, other: TripAccess | null): TripAccess | null {
  if (held === null) return other;
  if (other === null) return held;
  return Number(other.accessRev) > Number(held.accessRev) ? other : held;
}

/**
 * Hands every widget under it the trip's member names. `null` until the access
 * read lands, and if it fails — a widget then says "Traveler 2", which beats a
 * notebook that will not open over a name.
 *
 * **Inside the trip's own `TripProvider`, its live `access` is the source**
 * (self-review of pull request 359). This provider's read is the cached one at
 * mount, and nothing re-made it: a role change, a join or a colour the trip
 * re-resolved moved the People section and the header's avatars and left
 * every History row and suggestion chip on the mount's answer. `TripProvider`
 * re-reads access whenever the poll's `accessRev` moves, so following it is
 * what keeps the chips with the rest. Its own read stays, for a notebook
 * rendered outside a trip and for `recheck` below; whichever read is newer by
 * `accessRev` wins.
 */
export function PeopleProvider({ tripId, children }: { tripId: string; children: ReactNode }) {
  const trip = useOptionalTrip();
  const live = trip !== null && trip.tripId === tripId ? trip.access : null;
  const [read, setRead] = useState<TripAccess | null>(null);
  const [rechecked, setRechecked] = useState<ReadonlySet<string>>(NO_ONE);
  const asked = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    void cachedRead(tripKeys.access(tripId), () => fetchTripAccess(tripId)).then((access) => {
      if (!cancelled && access.ok) setRead(access.value);
    });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  // The read above is the cached one, so a member who joined after it is not
  // in it (review of #311, 3.1: a new suggester's change said "a former
  // traveler"). Asked about by id, it is read again past the cache — once per
  // id, however often it renders. A failed read marks nothing: the member is
  // not called gone on a network error, and is no longer counted as asked, so
  // the next change of authors asks again (review of #311, CodeRabbit).
  const recheck = useCallback(
    (userId: string) => {
      if (asked.current.has(userId)) return;
      asked.current.add(userId);
      invalidate(tripKeys.access(tripId));
      void cachedRead(tripKeys.access(tripId), () => fetchTripAccess(tripId)).then((access) => {
        if (!access.ok) {
          asked.current.delete(userId);
          return;
        }
        setRead(access.value);
        setRechecked((prev) => new Set(prev).add(userId));
      });
    },
    [tripId],
  );

  // Derived, so the names and the personas can never come from different reads.
  const access = newerAccess(live, read);
  const personas = useMemo(() => (access === null ? null : personasOf(access.members)), [access]);
  const names = useMemo(() => (personas === null ? null : namesOf(personas)), [personas]);
  const value = useMemo(() => ({ names, personas, rechecked, recheck }), [names, personas, rechecked, recheck]);
  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}

/** The member names `PeopleProvider` handed down; `null` outside one or before they land. */
export function usePeople(): Readonly<Record<string, string>> | null {
  return useContext(PeopleContext).names;
}

/** Each member's persona by userId (M38); `null` outside a `PeopleProvider` or before it lands. */
export function usePersonas(): Readonly<Record<string, Persona>> | null {
  return useContext(PeopleContext).personas;
}

/** The names, plus the means to ask about a member they do not hold yet. */
export function usePeopleRecheck(): People {
  return useContext(PeopleContext);
}
