"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { NativeSelect } from "@/components/ui/native-select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { PlaybookCard, type PlaybookCard as PlaybookCardData } from "./PlaybookCard";

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "mine", label: "Yours" },
  { value: "shared", label: "Shared" },
  { value: "links", label: "From links" },
] as const;

type FilterValue = (typeof FILTER_OPTIONS)[number]["value"];

// Handoff README §3 "Playbooks": intro copy, info Banner, SegmentedControl
// filter + city NativeSelect, 3-col grid of playbook Cards, closing with a
// dashed "Community Playbooks" placeholder. The whole screen is always
// mounted by its caller (app/playbooks/page.tsx) inside
// <Preview id="playbooks-route"> (Task 3's seam), which shields pointer
// events and stamps the "Preview · M11" chip — so the filter/select below
// stay real, controlled inputs (same "wire it, but shield it" contract
// KeepDayFlag/KeepDayDialog use) rather than needing a fake uncontrolled
// stand-in; their state just never reaches a mouse in production until M11
// removes that outer wrap. Filtering the grid itself is explicitly out of
// scope here (no real Playbooks list to filter yet) — the controls exist to
// match the handoff's layout, not to narrow `playbooks` below.
export function PlaybooksScreen({ playbooks }: { playbooks: PlaybookCardData[] }) {
  const [filter, setFilter] = useState<FilterValue>("all");
  const cities = Array.from(new Set(playbooks.map((pb) => pb.city))).sort();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Heading level={1}>Playbooks</Heading>
        <Text variant="secondary" className="mt-1.5 max-w-2xl">
          A Playbook is one good day, saved on its own — the stops, the order, the timings, the notes. Drop it into
          any trip and the times reflow around it. Send one to a friend without sharing your whole trip.
        </Text>
      </div>

      <Banner variant="info">
        Playbooks keep places and gaps, not dates. Insert one and every stop shifts to the day you chose.
      </Banner>

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl value={filter} onValueChange={setFilter} options={FILTER_OPTIONS} aria-label="Filter" />
        <div className="flex-1" />
        <NativeSelect aria-label="City" defaultValue="all-cities">
          <option value="all-cities">All cities</option>
          {cities.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {playbooks.map((pb) => (
          <PlaybookCard key={pb.id} playbook={pb} />
        ))}
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong p-5 text-center">
          <Heading level={4}>Community Playbooks</Heading>
          <Text variant="secondary">
            Browse days from people who have already been where you are going. Coming after link sharing.
          </Text>
          <Button type="button" variant="secondary" size="sm" className="mt-1">
            Notify me
          </Button>
        </div>
      </div>
    </div>
  );
}
