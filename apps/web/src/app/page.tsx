"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { TripSummary } from "@tc/contracts";

export default function Home() {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/trips");
    if (res.status === 401) {
      setUnauthenticated(true);
      return;
    }
    const data = (await res.json()) as { trips: TripSummary[] };
    setUnauthenticated(false);
    setTrips(data.trips);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createTrip(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Something went wrong");
      return;
    }
    setName("");
    await load();
  }

  if (unauthenticated) {
    return (
      <main>
        <h1>travel-collab</h1>
        <Link href="/api/auth/signin?callbackUrl=/">Sign in</Link>
      </main>
    );
  }

  return (
    <main>
      <h1>Your trips</h1>
      <form onSubmit={createTrip}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Trip name"
          aria-label="Trip name"
        />
        <button type="submit">Create trip</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul>
        {(trips ?? []).map((t) => (
          <li key={t.tripId}>
            <Link href={`/trips/${t.tripId}`}>{t.name}</Link>
          </li>
        ))}
      </ul>
      {trips !== null && trips.length === 0 && <p>No trips yet — create one.</p>}
    </main>
  );
}
