"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { travellerIds, type TripMemberProfile } from "@tc/contracts";
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
 * avatar they chose and the colour `TripAccess` resolved for this trip (D3), and
 * whether they are going — what `trip.people` reads (`WidgetContext.personas`).
 */
export type Persona = { name: string; travelling: boolean } & Pick<TripMemberProfile, "avatar" | "color">;

/** userId → their persona, for every member `TripAccess` lists. */
export function personasOf(members: readonly TripMemberProfile[]): Readonly<Record<string, Persona>> {
  // `travellerIds` holds the one reading of an absent `travelling` (D2).
  const going = new Set(travellerIds(members));
  return Object.fromEntries(
    members.map((m) => [
      m.userId,
      {
        name: displayNameFor({ userId: m.userId, displayName: m.displayName, name: m.name, email: null }),
        avatar: m.avatar,
        color: m.color,
        travelling: going.has(m.userId),
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
 * Hands every widget under it the trip's member names. `null` until the access
 * read lands, and if it fails — a widget then says "Traveler 2", which beats a
 * notebook that will not open over a name.
 */
export function PeopleProvider({ tripId, children }: { tripId: string; children: ReactNode }) {
  const [personas, setPersonas] = useState<Readonly<Record<string, Persona>> | null>(null);
  const [rechecked, setRechecked] = useState<ReadonlySet<string>>(NO_ONE);
  const asked = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    void cachedRead(tripKeys.access(tripId), () => fetchTripAccess(tripId)).then((access) => {
      if (!cancelled && access.ok) setPersonas(personasOf(access.value.members));
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
        setPersonas(personasOf(access.value.members));
        setRechecked((prev) => new Set(prev).add(userId));
      });
    },
    [tripId],
  );

  // Derived, so the names and the personas can never come from different reads.
  const names = useMemo(() => (personas === null ? null : namesOf(personas)), [personas]);
  const value = useMemo(() => ({ names, personas, rechecked, recheck }), [names, personas, rechecked, recheck]);
  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}

/**
 * Hands the widgets under it people somebody already has — the invite preview's
 * (M38), whose holder may not read `TripAccess` — rather than reading them.
 */
export function FixedPeopleProvider({ personas, children }: { personas: Readonly<Record<string, Persona>>; children: ReactNode }) {
  const value = useMemo(() => ({ names: namesOf(personas), personas, rechecked: NO_ONE, recheck: () => {} }), [personas]);
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
