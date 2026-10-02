"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { TripMemberProfile } from "@tc/contracts";
import { fetchTripAccess } from "@/lib/apiClient";
import { cachedRead } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import { displayNameFor } from "@/lib/displayName";

// What a notebook widget calls each member (`WidgetContext.people`, M19 part 2).
//
// **Not a new read.** The names are the Travelers list's own join —
// `TripAccess.members`, which `PageScreen` and `TripProvider` already fetch
// under `tripKeys.access` — so the provider below asks the cache for the
// response those surfaces share, and `displayNameFor` is the one rule that
// turns a member into a name.
//
// **Never an email.** `displayNameFor` falls back to one, and a notebook is a
// shared document that a collaborator reads: the invite landing resolves names
// the same way, with `email: null`, and `attribute`'s `account.name` states the
// rule for a page. A member with no name reads as their handle instead.

/** userId → what to call them, for every member `TripAccess` lists. */
export function peopleNamesOf(members: readonly TripMemberProfile[]): Readonly<Record<string, string>> {
  return Object.fromEntries(
    members.map((m) => [m.userId, displayNameFor({ userId: m.userId, name: m.name, email: null })]),
  );
}

const PeopleContext = createContext<Readonly<Record<string, string>> | null>(null);

/**
 * Hands every widget under it the trip's member names. `null` until the access
 * read lands, and if it fails — a widget then says "Traveler 2", which beats a
 * notebook that will not open over a name.
 */
export function PeopleProvider({ tripId, children }: { tripId: string; children: ReactNode }) {
  const [people, setPeople] = useState<Readonly<Record<string, string>> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void cachedRead(tripKeys.access(tripId), () => fetchTripAccess(tripId)).then((access) => {
      if (!cancelled && access.ok) setPeople(peopleNamesOf(access.value.members));
    });
    return () => {
      cancelled = true;
    };
  }, [tripId]);
  return <PeopleContext.Provider value={people}>{children}</PeopleContext.Provider>;
}

/** The member names `PeopleProvider` handed down; `null` outside one or before they land. */
export function usePeople(): Readonly<Record<string, string>> | null {
  return useContext(PeopleContext);
}
