"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { TripSummary } from "@tc/contracts";
import { Heading } from "../components/ui/heading";
import { Text } from "../components/ui/text";
import { DataText } from "../components/ui/data-text";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card } from "../components/ui/card";
import { FormField } from "../components/ui/form-field";
import { EmptyState } from "../components/ui/empty-state";

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
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Heading level={1}>travel-collab</Heading>
        <Link
          href="/api/auth/signin?callbackUrl=/"
          className="mt-4 inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border-strong bg-surface px-3.5 text-base font-medium text-ink transition-colors hover:bg-moss"
        >
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <SpeedInsights />
      <Heading level={1}>Your trips</Heading>
      <form onSubmit={createTrip} className="mt-4 flex items-end gap-2">
        <FormField id="trip-name" label="Trip name">
          <Input
            id="trip-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Trip name"
            aria-label="Trip name"
          />
        </FormField>
        <Button type="submit" variant="primary">
          Create trip
        </Button>
      </form>
      {error && (
        <Text role="alert" variant="secondary" className="mt-2 text-danger-ink">
          {error}
        </Text>
      )}
      {trips !== null && trips.length === 0 ? (
        <EmptyState title="Start your first trip" body="No trips yet — create one." />
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {(trips ?? []).map((t) => (
            <Card key={t.tripId} as="li">
              <Link href={`/trips/${t.tripId}`} className="text-brand font-medium hover:underline">
                {t.name}
              </Link>
              <div>
                <DataText>{t.createdAt}</DataText>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </main>
  );
}
